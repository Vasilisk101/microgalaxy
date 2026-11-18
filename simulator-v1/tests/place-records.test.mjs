import test from 'node:test';
import assert from 'node:assert/strict';
import * as Current from '../src/core.mjs';
import * as Released from '../src/previous-core.mjs';
import * as Legacy from '../../simulator-v08/src/core.mjs';
import {placeRecords,placeSubject,placeName,eventPlaces,eventDetail} from '../src/place-records.mjs';

const industrial=(engine,seed,year)=>engine.advance(engine.createWorld(seed,{era:'industrial'}),year).world;
const byId=(w,key)=>Current.allEvents(w).find(e=>e.id===key);

test('Ренон: два переселения по одному маршруту и только одна записанная связь с засухой',()=>{
  const w=industrial(Current,'BASIN-6',100),saved=JSON.stringify(w);
  assert.equal(w.observatory.living.basin,null);
  assert.equal(placeSubject(w),'r6');assert.equal(placeName(w,'r6'),'Ренон');
  const rows=placeRecords(w,'r6');
  assert.deepEqual(rows.map(r=>[r.year,r.kind]),[[28,'drought'],[30,'movement'],[60,'movement']]);
  assert.match(rows[1].text,/Ренон.*Белур.*37/);
  assert.match(rows[2].text,/45/);
  assert.deepEqual(rows[1].relatedIds,[rows[0].id]);assert.deepEqual(rows[2].relatedIds,[]);
  assert.deepEqual(eventPlaces(w,byId(w,'e17')),['r6']);
  assert.deepEqual(eventPlaces(w,byId(w,'e20')),['r6','r15']);
  assert.equal(placeRecords(w,'r15').find(r=>r.sourceId==='e20').title,'Прибыли переселенцы');
  assert.equal(placeRecords(w,'r15').some(r=>r.sourceId==='e17'),false);
  for(const r of rows)assert.doesNotMatch([r.title,r.text,r.source,r.detail].join(' '),/\br\d+\b/);
  assert.equal(JSON.stringify(w),saved);
});

test('выбранный регион сохраняется при перемотке; поздние сведения отсутствуют и у записей, и у источника',()=>{
  const w=industrial(Current,'BASIN-6',100),snapshot=Current.viewSnapshot(w,0),event=byId(w,'e17');
  assert.equal(placeSubject(snapshot,'r6'),'r6');assert.equal(placeRecords(snapshot,'r6').length,0);
  assert.deepEqual(eventPlaces(snapshot,event),[]);assert.equal(eventDetail(snapshot,event),'');
  const started=industrial(Current,'BASIN-6',28);
  assert.equal(placeSubject(started),'r6');
  assert.equal(placeRecords(started,'r6').length,1);
  assert.doesNotMatch(eventDetail(started,event),/31/);
  assert.match(eventDetail(w,event),/31/);
  assert.equal(placeSubject(w,'r15'),'r15');assert.deepEqual(placeRecords(w,'не существует'),[]);
});

test('Илмир: независимые записи начала работ, оплаты, смены цели и дат обнаружения',()=>{
  const w=industrial(Current,'МЕАНДР-19',46),id=placeSubject(w),rows=placeRecords(w,id);
  assert.equal(placeName(w,id),'Илмир');
  assert.deepEqual(rows.map(r=>[r.year,r.kind]),[[3,'foundation'],[3,'payment'],[13,'purpose'],[16,'completed'],[33,'discovery'],[33,'discovery'],[46,'discovery']]);
  assert.equal(new Set(rows.map(r=>r.id)).size,rows.length);
  assert.match(rows[0].text,/сохранение переправы/);assert.match(rows[2].text,/хозяйств водой/);
  assert.equal(rows[4].relatedIds[0],rows[0].id);assert.match(rows[6].title,/пазы водосброса/);
  const before={...w,year:16}; // The reader must enforce the cutoff even if a caller retained the full archive.
  assert.deepEqual(placeRecords(before,id).map(r=>r.id),rows.slice(0,4).map(r=>r.id));
  assert.equal(placeRecords(w,w.observatory.living.basin.lower).some(r=>r.kind==='foundation'),false);
});

test('одноимённые места различаются по координатам, привязка к обществу сама по себе недостаточна',()=>{
  const w=industrial(Current,'BASIN-6',60),move=byId(w,'e20'),a=w.regions.find(x=>x.id===move.movement.from),b=w.regions.find(x=>x.id===move.movement.to);
  a.settlement.name=b.settlement.name='Орбор';
  assert.notEqual(placeName(w,a.id),placeName(w,b.id));
  const details=eventDetail(w,move);
  assert.ok(details.includes(placeName(w,a.id)));assert.ok(details.includes(placeName(w,b.id)));
  assert.doesNotMatch(details,/\br\d+\b/);
  const fake={id:'unrelated',year:20,type:'politics',title:'Смена курса',entityId:a.owner,detail:'Орбор обсуждал меры в регионе r6.'};
  assert.deepEqual(eventPlaces(w,fake),[]);
  const drought={...fake,type:'climate',title:'Региональная засуха',detail:'Урожайность региона r58 снижена до 25 года.'};
  assert.deepEqual(eventPlaces(w,drought),['r58']);assert.doesNotMatch(eventDetail(w,drought),/r58/);
  assert.ok(eventDetail(w,drought).includes(placeName(w,'r58')));
});

test('читатель работает на выпущенных старых правилах и не создаёт отсутствующих речных записей',()=>{
  const earlier=industrial(Released,'BASIN-1',60),at=placeSubject(earlier);
  assert.deepEqual(placeRecords(earlier,at).filter(r=>['foundation','completed'].includes(r.kind)).map(r=>r.year),[47,57]);
  const old=industrial(Legacy,'BASIN-6',60);
  assert.ok(!old.observatory);
  assert.ok(placeRecords(old,placeSubject(old)).some(r=>r.kind==='movement'));
  assert.deepEqual(placeRecords({year:0,regions:[],societies:[]},'r1'),[]);
  assert.equal(placeSubject({year:0,regions:[],societies:[]}),null);
});
