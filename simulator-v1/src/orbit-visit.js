// Sample visits own their worlds. Opening the atlas of an archive uses its displayed snapshot.
const OrbitVisit = (() => {
  const samples = {callisto:{seed:'КАЛЛИСТО',year:5},perseids:{seed:'ПЕРСЕИДЫ',year:10}};
  const dialog = () => document.getElementById('orbit-dialog');
  let returnAddress = null;
  function isDemoLink(){
    const params=new URLSearchParams(location.search);
    return !PlaceVisit.isDemoLink() && Object.hasOwn(samples,params.get('atlas')||'');
  }
  function address(path){try{history.replaceState(null,'',path);}catch{/* file:// preview */}}
  function close(){
    if(dialog().open)dialog().close();
    OrbitAtlas.close();
    if(returnAddress!==null){address(returnAddress);returnAddress=null;}
    startObservatory();
  }
  function sample(key,params=new URLSearchParams()){
    if(!Object.hasOwn(samples,key))return;
    setRunning(false);
    if($('#dialog').open)$('#dialog').close();
    const {seed,year}=samples[key], shown=Core.createWorld(seed,{era:'space'});
    const url=new URL(location.href);
    returnAddress=isDemoLink()?url.pathname:url.pathname+url.search+url.hash;
    const bodyId=shown.planets.find(p=>p.id===params.get('body'))?.id;
    const requested=params.get('view'),mode=['system','family','globe','surface'].includes(requested)?requested:'system';
    const query=new URLSearchParams({atlas:key});
    if(bodyId)query.set('body',bodyId);
    if(mode!=='system')query.set('view',mode);
    address(url.pathname+'?'+query);
    OrbitAtlas.open(dialog(),shown,{demo:true,year,bodyId,mode,onClose:close});
  }
  function open(mode){
    if(!world)return;
    setRunning(false);
    if($('#dialog').open)$('#dialog').close();
    OrbitAtlas.open(dialog(),displayed(),{bodyId:selectedPlanet,mode,onClose:close,onPlace:()=>{
      close();PlaceVisit.open(selectedRegion);
    }});
  }
  function entry(){
    return '<div class="place-entries"><span>Два орбитальных атласа</span><button data-orbit-sample="callisto">Каллисто</button><button data-orbit-sample="perseids">Персеиды</button></div>';
  }
  function attach(){
    document.addEventListener('click',event=>{
      const el=event.target.closest('[data-orbit-open],[data-orbit-sample]');
      if(!el)return;
      event.preventDefault();event.stopImmediatePropagation();
      if(el.dataset.orbitSample)sample(el.dataset.orbitSample);
      else open(el.dataset.orbitOpen);
    },true);
    const params=new URLSearchParams(location.search);
    if(isDemoLink())sample(params.get('atlas'),params);
  }
  return {attach,open,entry,isDemoLink};
})();
