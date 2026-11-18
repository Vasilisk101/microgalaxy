"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { World } from "@/lib/simulation";
import {
  surfaceVertex, surfaceFragment, cloudFragment,
  atmosphereFragment, starFragment,
} from "./cosmos-shaders";
import SoftwareCosmos from "./SoftwareCosmos";

export interface CosmosSceneProps {
  world: World;
  mode: "planet" | "system";
  selectedPlanetId: string;
  onSelectPlanet: (planetId: string) => void;
  layer: "natural" | "political" | "climate";
  selectedSocietyId?: string;
  /** Increment to reset the view. */
  focus?: number;
}

type Planet = World["planets"][number];
type Society = World["societies"][number];
type Body = {
  planet: Planet;
  group: THREE.Group;
  surface: THREE.ShaderMaterial;
  clouds?: THREE.ShaderMaterial;
  atmosphere?: THREE.ShaderMaterial;
  orbitRadius?: number;
};
type SceneLabel = {
  element: HTMLElement;
  position: THREE.Vector3;
  body?: Body;
  cityDirection?: THREE.Vector3;
  cityId?: string;
};

const lightDirection = new THREE.Vector3(-4.2, 3.1, 5.5).normalize();
const TAU = Math.PI * 2;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function randomSource(seed: number) {
  let x = seed >>> 0;
  return () => {
    x += 0x6d2b79f5;
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function directionFromCoordinates(lat: number, lon: number) {
  const phi = (lat * Math.PI) / 180;
  const theta = (lon * Math.PI) / 180;
  return new THREE.Vector3(Math.cos(phi) * Math.sin(theta), Math.sin(phi), Math.cos(phi) * Math.cos(theta));
}

function surfaceMaterial(planet: Planet) {
  return new THREE.ShaderMaterial({
    vertexShader: surfaceVertex,
    fragmentShader: surfaceFragment,
    uniforms: {
      uSeed: { value: Math.abs(planet.seed % 10007) },
      uWater: { value: planet.water },
      uTemperature: { value: planet.temp },
      uYear: { value: 0 },
      uKind: { value: { rocky: 0, ocean: 1, desert: 2, gas: 3, ice: 4 }[planet.kind] },
      uLayer: { value: 0 },
      uHasAtmosphere: { value: planet.habitable || planet.kind === "ocean" || planet.kind === "gas" ? 1 : 0 },
      uBaseColor: { value: new THREE.Color(planet.color) },
      uLight: { value: lightDirection.clone() },
      uCityCount: { value: 0 },
      uCityDirections: { value: Array.from({ length: 12 }, () => new THREE.Vector3()) },
      uCityColors: { value: Array.from({ length: 12 }, () => new THREE.Color()) },
      uCitySizes: { value: new Float32Array(12) },
    },
  });
}

function createBody(planet: Planet, radius: number, detail: boolean): Body {
  const group = new THREE.Group();
  const surface = surfaceMaterial(planet);
  const geometry = new THREE.SphereGeometry(radius, detail ? 88 : 36, detail ? 56 : 24);
  const sphere = new THREE.Mesh(geometry, surface);
  sphere.userData.planetId = planet.id;
  group.add(sphere);
  group.rotation.z = -0.17;
  group.rotation.y = -0.24;

  let clouds: THREE.ShaderMaterial | undefined;
  if (planet.habitable || planet.kind === "ocean") {
    clouds = new THREE.ShaderMaterial({
      vertexShader: surfaceVertex,
      fragmentShader: cloudFragment,
      uniforms: {
        uSeed: { value: Math.abs(planet.seed % 10007) },
        uYear: { value: 0 },
        uLight: { value: lightDirection.clone() },
      },
      transparent: true,
      depthWrite: false,
    });
    const cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.009, detail ? 80 : 32, detail ? 48 : 20), clouds);
    group.add(cloudMesh);
  }

  let atmosphere: THREE.ShaderMaterial | undefined;
  if (planet.habitable || planet.kind === "ocean" || planet.kind === "gas") {
    atmosphere = new THREE.ShaderMaterial({
      vertexShader: surfaceVertex,
      fragmentShader: atmosphereFragment,
      uniforms: {
        uLight: { value: lightDirection.clone() },
        uColor: { value: new THREE.Color(planet.kind === "gas" ? "#ad956e" : "#427baf") },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
    });
    group.add(new THREE.Mesh(new THREE.SphereGeometry(radius * 1.035, detail ? 80 : 32, detail ? 48 : 20), atmosphere));
  }

  if (planet.kind === "gas" && planet.seed % 3 !== 0) {
    const ringGeometry = new THREE.RingGeometry(radius * 1.35, radius * 2.05, 128, 4);
    const positions = ringGeometry.attributes.position;
    const colors = [];
    for (let i = 0; i < positions.count; i++) {
      const r = Math.hypot(positions.getX(i), positions.getY(i)) / radius;
      const band = 0.52 + Math.sin(r * 195) * 0.12 + Math.sin(r * 51) * 0.13;
      colors.push(band * 0.75, band * 0.66, band * 0.51);
    }
    ringGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const ring = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.66, depthWrite: false }));
    ring.rotation.x = Math.PI / 2.2;
    ring.rotation.y = 0.15;
    group.add(ring);
  }
  return { planet, group, surface, clouds, atmosphere };
}

function addStars(scene: THREE.Scene, seed: number) {
  const rng = randomSource(seed);
  const positions: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < 1550; i++) {
    const longitude = rng() * TAU;
    const z = rng() * 2 - 1;
    const radial = Math.sqrt(1 - z * z);
    const r = 70 + rng() * 30;
    positions.push(radial * Math.cos(longitude) * r, z * r, radial * Math.sin(longitude) * r);
    const brightness = rng() ** 3 * 0.62 + 0.10;
    const warmth = rng();
    colors.push(brightness * (0.76 + warmth * 0.24), brightness * 0.84, brightness * (0.98 - warmth * 0.20));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({ size: 0.11, vertexColors: true, transparent: true, opacity: 0.8, sizeAttenuation: true, depthWrite: false });
  scene.add(new THREE.Points(geometry, material));
}

function makeStar(color: string, seed: number) {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.SphereGeometry(0.55, 48, 32), new THREE.ShaderMaterial({
    vertexShader: surfaceVertex,
    fragmentShader: starFragment,
    uniforms: { uColor: { value: new THREE.Color(color) }, uSeed: { value: seed % 100 } },
  })));
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(255,226,173,.55)");
    gradient.addColorStop(0.2, "rgba(255,208,143,.20)");
    gradient.addColorStop(0.5, "rgba(211,154,89,.04)");
    gradient.addColorStop(1, "rgba(160,100,40,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sprite.scale.set(4.5, 4.5, 1);
    group.add(sprite);
  }
  return group;
}

function disposeScene(scene: THREE.Scene) {
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) {
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) {
    const mapped = material as THREE.MeshBasicMaterial;
    mapped.map?.dispose();
    material.dispose();
  }
}

export default function CosmosScene(props: CosmosSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const resetRef = useRef<(() => void) | null>(null);
  const focusSocietyRef = useRef<((societyId?: string) => void) | null>(null);
  const softwareOnlyRef = useRef(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (softwareOnlyRef.current) { setFailure("software"); return; }
    setFailure(null);
    const { world, mode, selectedPlanetId } = propsRef.current;
    const selected = world.planets.find((planet) => planet.id === selectedPlanetId) ?? world.planets[0];
    if (!selected) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    } catch {
      softwareOnlyRef.current = true;
      setFailure("software");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
    // A context can be available while this device cannot compile a shader.
    // Switch to the software scene instead of leaving an empty viewport.
    renderer.debug.onShaderError = () => {
      softwareOnlyRef.current = true;
      setFailure("software");
    };
    renderer.setClearColor("#06090c", 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:none;outline:none;";
    renderer.domElement.setAttribute("aria-label", mode === "planet" ? `Глобус: ${selected.name}. Перетаскивайте для поворота, прокручивайте для приближения.` : "Звёздная система. Нажмите на планету, чтобы выбрать её.");
    renderer.domElement.setAttribute("role", "img");
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(mode === "planet" ? 36 : 43, 1, 0.1, 160);
    let needsRender = true;
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableDamping = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    controls.dampingFactor = 0.09;
    controls.rotateSpeed = 0.52;
    controls.zoomSpeed = 0.75;
    controls.minPolarAngle = 0.18;
    controls.maxPolarAngle = Math.PI - 0.18;
    controls.addEventListener("change", () => { needsRender = true; });
    const reset = () => {
      const aspectScale = Math.max(1, host.clientHeight / Math.max(1, host.clientWidth));
      if (mode === "planet") {
        camera.position.set(0, 0.25, 7.6 * aspectScale);
        controls.minDistance = 3.3;
        controls.maxDistance = 13;
      } else {
        const distance = Math.max(14, (2 + (world.planets.length - 1) * 1.42) * 2.0) * aspectScale;
        camera.position.set(0, distance * 0.82, distance);
        controls.minDistance = 5;
        controls.maxDistance = Math.max(42, distance * 2);
      }
      controls.target.set(0, 0, 0);
      controls.update();
      needsRender = true;
    };
    resetRef.current = reset;
    reset();
    addStars(scene, selected.seed);

    const overlay = document.createElement("div");
    overlay.style.cssText = "position:absolute;inset:0;overflow:hidden;pointer-events:none;";
    host.appendChild(overlay);
    const labels: SceneLabel[] = [];
    const bodies: Body[] = [];
    const pickable: THREE.Object3D[] = [];

    function addLabel(text: string, planetId?: string, color?: string) {
      const element = document.createElement(planetId ? "button" : "div");
      element.textContent = text;
      element.style.cssText = "position:absolute;left:0;top:0;white-space:nowrap;padding:4px 8px;border:1px solid transparent;border-radius:3px;background:rgba(6,9,12,.68);font:11px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace;color:#bcc7ca;transform:translate(-50%,-50%);transition:color .15s,border-color .15s;";
      if (planetId) {
        element.style.pointerEvents = "auto";
        element.style.cursor = "pointer";
        element.style.borderColor = planetId === selectedPlanetId ? "#688b80" : "rgba(187,201,198,.12)";
        element.setAttribute("aria-label", `Открыть планету ${text}`);
        element.addEventListener("click", () => propsRef.current.onSelectPlanet(planetId));
      }
      if (color) element.style.color = color;
      overlay.appendChild(element);
      return element;
    }

    if (mode === "planet") {
      const body = createBody(selected, 2, true);
      scene.add(body.group);
      bodies.push(body);
      for (const society of world.societies.filter((s) => s.planetId === selected.id).slice(0, 12)) {
        const element = addLabel(society.name, undefined, society.color);
        labels.push({ element, body, cityDirection: directionFromCoordinates(society.lat, society.lon), cityId: society.id, position: new THREE.Vector3() });
      }
      // Small, schematic orbital tracks reflect actual active missions.
      const orbitGroup = new THREE.Group();
      orbitGroup.name = "mission-orbits";
      scene.add(orbitGroup);
    } else {
      scene.add(makeStar(world.star.color, selected.seed));
      const starLabel = addLabel(world.star.name, undefined, "#ccae80");
      labels.push({ element: starLabel, position: new THREE.Vector3(0, -0.9, 0) });
      world.planets.forEach((planet, index) => {
        const orbitRadius = 2 + index * 1.42;
        const radius = clamp(0.18 * Math.cbrt(planet.radius), 0.15, 0.46);
        const body = createBody(planet, radius, false);
        body.orbitRadius = orbitRadius;
        bodies.push(body);
        scene.add(body.group);
        body.group.children.forEach((child) => { if (child.userData.planetId) pickable.push(child); });
        const points: THREE.Vector3[] = [];
        for (let i = 0; i <= 180; i++) {
          const angle = (i / 180) * TAU;
          points.push(new THREE.Vector3(Math.sin(angle) * orbitRadius, 0, Math.cos(angle) * orbitRadius));
        }
        const orbit = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: planet.id === selectedPlanetId ? "#55786e" : "#253238", transparent: true, opacity: planet.id === selectedPlanetId ? 0.72 : 0.55 }));
        scene.add(orbit);
        labels.push({ element: addLabel(planet.name, planet.id), body, position: new THREE.Vector3() });
      });
    }

    focusSocietyRef.current = (societyId?: string) => {
      if (!societyId || mode !== "planet" || !bodies[0]) return;
      const society = propsRef.current.world.societies.find((item) => item.id === societyId && item.planetId === selected.id);
      if (!society) return;
      const direction = directionFromCoordinates(society.lat, society.lon).applyQuaternion(bodies[0].group.quaternion);
      camera.position.copy(direction).multiplyScalar(clamp(camera.position.length(), 5.5, 9));
      controls.update();
    };
    focusSocietyRef.current(propsRef.current.selectedSocietyId);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDown = { x: 0, y: 0 };
    const handleDown = (event: PointerEvent) => { pointerDown = { x: event.clientX, y: event.clientY }; };
    const handleUp = (event: PointerEvent) => {
      if (mode !== "system" || Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(pickable)[0];
      if (hit?.object.userData.planetId) propsRef.current.onSelectPlanet(hit.object.userData.planetId as string);
    };
    renderer.domElement.addEventListener("pointerdown", handleDown);
    renderer.domElement.addEventListener("pointerup", handleUp);

    let width = 1;
    let height = 1;
    const resize = () => {
      width = Math.max(1, host.clientWidth);
      height = Math.max(1, host.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      needsRender = true;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    const projected = new THREE.Vector3();
    const worldDirection = new THREE.Vector3();
    let frame = 0;
    let lastWorld: World | null = null;
    let lastLayer = "";
    let lastSociety: string | undefined;
    let lastMissions = -1;

    const refreshBody = (body: Body, current: World, societies: Society[]) => {
      const uniforms = body.surface.uniforms;
      if (mode === "system") {
        const orbitalPeriod = Math.sqrt(body.planet.orbit ** 3 / Math.max(0.1, current.star.mass));
        const angle = (body.planet.seed % 1000) * 0.00628 + (current.year / orbitalPeriod) * TAU;
        body.group.position.set(Math.sin(angle) * body.orbitRadius!, 0, Math.cos(angle) * body.orbitRadius!);
      }
      const sunlight = mode === "system" ? body.group.position.clone().negate().normalize() : lightDirection;
      uniforms.uYear.value = current.year;
      uniforms.uLayer.value = { natural: 0, political: 1, climate: 2 }[propsRef.current.layer];
      uniforms.uTemperature.value = body.planet.id === current.homePlanetId ? current.climate.temperature : body.planet.temp;
      uniforms.uCityCount.value = Math.min(12, societies.length);
      societies.slice(0, 12).forEach((society, index) => {
        uniforms.uCityDirections.value[index].copy(directionFromCoordinates(society.lat, society.lon));
        uniforms.uCityColors.value[index].set(society.color);
        uniforms.uCitySizes.value[index] = clamp(Math.log10(Math.max(society.population, 1)) / 9, 0.1, 1.3) * clamp((society.tech - 50) / 40, 0, 1);
      });
      uniforms.uLight.value.copy(sunlight);
      if (body.clouds) {
        body.clouds.visible = propsRef.current.layer === "natural";
        body.clouds.uniforms.uYear.value = current.year;
        body.clouds.uniforms.uLight.value.copy(sunlight);
      }
      body.atmosphere?.uniforms.uLight.value.copy(sunlight);
    };

    const syncSocietyLabels = (current: World) => {
      if (mode !== "planet") return;
      const societies = current.societies.filter((society) => society.planetId === selected.id).slice(0, 12);
      for (let i = labels.length - 1; i >= 0; i--) {
        if (labels[i].cityId && !societies.some((society) => society.id === labels[i].cityId)) {
          labels[i].element.remove();
          labels.splice(i, 1);
        }
      }
      for (const society of societies) {
        const existing = labels.find((label) => label.cityId === society.id);
        if (existing) {
          existing.element.textContent = society.name;
          existing.element.style.color = society.color;
        } else {
          labels.push({ element: addLabel(society.name, undefined, society.color), body: bodies[0], cityDirection: directionFromCoordinates(society.lat, society.lon), cityId: society.id, position: new THREE.Vector3() });
        }
      }
    };

    const updateMissionOrbits = (current: World) => {
      if (mode !== "planet") return;
      const group = scene.getObjectByName("mission-orbits") as THREE.Group;
      const missions = current.missions.filter((mission) => mission.planetId === selected.id && mission.active);
      if (missions.length === lastMissions) return;
      lastMissions = missions.length;
      for (const child of [...group.children]) {
        const line = child as THREE.Line;
        line.geometry?.dispose();
        (line.material as THREE.Material)?.dispose();
        group.remove(child);
      }
      missions.slice(0, 4).forEach((mission, index) => {
        const radius = 2.25 + index * 0.14;
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 128; i++) {
          const angle = i / 128 * TAU;
          pts.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0));
        }
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: "#799b8c", transparent: true, opacity: 0.24, depthWrite: false }));
        line.rotation.x = 0.65 + index * 0.37;
        line.rotation.y = index * 1.8;
        line.name = mission.name;
        group.add(line);
      });
    };

    const render = () => {
      frame = window.requestAnimationFrame(render);
      if (document.hidden) return;
      const current = propsRef.current.world;
      if (current !== lastWorld || lastLayer !== propsRef.current.layer) {
        for (const body of bodies) refreshBody(body, current, current.societies.filter((society) => society.planetId === body.planet.id));
        syncSocietyLabels(current);
        updateMissionOrbits(current);
        lastWorld = current;
        lastLayer = propsRef.current.layer;
        needsRender = true;
      }
      if (lastSociety !== propsRef.current.selectedSocietyId) {
        lastSociety = propsRef.current.selectedSocietyId;
        needsRender = true;
      }
      controls.update();
      if (!needsRender) return;
      needsRender = false;
      scene.updateMatrixWorld();
      for (const label of labels) {
        if (label.body && label.cityDirection) {
          label.position.copy(label.cityDirection).multiplyScalar(2.03).applyMatrix4(label.body.group.matrixWorld);
          worldDirection.copy(label.position).normalize();
          const front = worldDirection.dot(camera.position.clone().normalize()) > 0.22;
          const show = front && (propsRef.current.layer === "political" || propsRef.current.selectedSocietyId === label.cityId);
          label.element.style.display = show ? "block" : "none";
          if (!show) continue;
        } else if (label.body) {
          label.position.copy(label.body.group.position);
          label.position.y -= 0.55;
        }
        projected.copy(label.position).project(camera);
        const visible = projected.z < 1 && Math.abs(projected.x) < 1.2 && Math.abs(projected.y) < 1.2;
        label.element.style.visibility = visible ? "visible" : "hidden";
        label.element.style.left = `${(projected.x * 0.5 + 0.5) * width}px`;
        label.element.style.top = `${(-projected.y * 0.5 + 0.5) * height}px`;
      }
      renderer.render(scene, camera);
    };
    render();
    const contextLost = (event: Event) => {
      event.preventDefault();
      window.cancelAnimationFrame(frame);
      softwareOnlyRef.current = true;
      setFailure("software");
    };
    renderer.domElement.addEventListener("webglcontextlost", contextLost);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      resetRef.current = null;
      focusSocietyRef.current = null;
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      renderer.domElement.removeEventListener("pointerdown", handleDown);
      renderer.domElement.removeEventListener("pointerup", handleUp);
      controls.dispose();
      disposeScene(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      overlay.remove();
    };
  // Including failure also disposes a lost GPU context as soon as the
  // software scene takes over, rather than waiting for a planet change.
  }, [props.world.id, props.mode, props.selectedPlanetId, failure]);

  useEffect(() => { resetRef.current?.(); }, [props.focus]);
  useEffect(() => { focusSocietyRef.current?.(props.selectedSocietyId); }, [props.selectedSocietyId]);

  return (
    <div ref={hostRef} className="cosmos-scene" style={{ position: "relative", width: "100%", height: "100%", minHeight: 260, overflow: "hidden", background: "#06090c" }}>
      {failure && <SoftwareCosmos {...props} />}
    </div>
  );
}
