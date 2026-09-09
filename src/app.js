import {Rumble} from "./rumble.js";
import { HzBridge } from "./hzbridge.js";
import { RunQuakeSonify } from "./sonify.js";
import { DayNightShader } from "./daynightshader.js";

export class App
{
  constructor(THREE, ThreeGlobe, TrackballControls, solar)
  {
    window.App = this;

    this.hzbridge = new HzBridge(document.getElementById("hzbridge"));

    this.THREE = THREE;
    this.ThreeGlobe = ThreeGlobe;
    this.TrackballControls = TrackballControls;
    this.solar = solar;

    this.initGlobe()
    .then(() =>
    {
      this.quakeInfo = document.getElementById("quakeInfo");
      this.rumble = new Rumble(this.globe, 
                    this.THREE, this.camera, 
                    this.trackball, this.quakeInfo);
      this.rumble.On("QuakeOn", (q) =>
      {
        if(this.soundActivated)
          this.hzbridge.Notify("QuakeMsg", {type: "QuakeOn", quake: q});
        else
          this.pendingQuakes.push(q);
      });
      this.rumble.On("QuakeOff", (q) =>
      {
        if(!this.soundActivated) return;
        this.hzbridge.Notify("QuakeMsg", {type: "QuakeOff", quake: q});
      });
      this.rumble.On("Alert", (maxmag) =>
      {
        if(!this.soundActivated) return;
        this.hzbridge.Notify("QuakeMsg", {type: "Alert", maxmag});
      });
      this.rumble.On("SimQuake", (mag, lat, lng, sig=0) =>
      {
        const now = Date.now();
        const event = {
          id: `id${now}`,
          geometry: {
            coordinates: [lng, lat, Math.random() * 10]
          },
          properties: {
            mag,
            time: now,
            sig: sig || Math.round(mag*100),
            place: "10 km S of Noplace..."
          }
        };
        this.rumble.earthquakeArrived(event);
        this.rumble.onNewQuake(mag);
      });
      this.rumble.On("FlyTo", (info) =>
      {
        console.log("flyto", Object.keys(info));
      });

      this.updateSunCB = this.updateSun.bind(this);
      this.updateSun();

      this.redrawCB = this.redraw.bind(this);
      this.redraw();

      this.soundActivated = false;
      this.pendingQuakes = [];
    });

    this.hzbridge.On("HzSbActivate", (onoff) =>
    {
      if(this.soundActivated == false)
      {
        this.hzbridge.EvalScript(RunQuakeSonify);
        this.soundActivated = true;
      }
    });

    this.hzbridge.On("QuakeSonifyReady", (msg) =>
    {
      console.log("Sonify ready!");
      for(let q of this.pendingQuakes)
        this.hzbridge.Notify("QuakeMsg", {type: "QuakeOn", quake: q});
      this.pendingQuakes = [];
    });

  }

  async FetchLocalFile(fileref, filetype="text")
  {
    throw new Error("File not found " + fileref);
  }

  polar2Cartesian(lng, lat)
  {
    const theta = this.THREE.MathUtils.degToRad(90 - lng);
    const phi = this.THREE.MathUtils.degToRad(90 - lat);
    return new this.THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.sin(theta)
    );
  }

  updateSun()
  {
    const now = new Date();
    const day = new Date(+now).setUTCHours(0, 0, 0, 0);
    const t = this.solar.century(now);
    const msPerDay = 864e5;
    const longitude = (day - now) / msPerDay * 360 - 180;   
    const lng = longitude - this.solar.equationOfTime(t) / 4; 
    const lat = this.solar.declination(t);
    this.sunDirection = this.polar2Cartesian(lng, lat).normalize();
    setTimeout(this.updateSunCB, 60*1000);
  }

  redraw()
  {
    this.trackball.update();
    if(this.globeMaterial)
    {
      const sunDirection = this.sunDirection.clone()
        .applyQuaternion(this.globe.quaternion)
        .normalize();
      this.globeMaterial.uniforms.sunDirection.value.copy(sunDirection);
    }
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.redrawCB);
  }

  async initGlobe()
  {
    this.globe = new this.ThreeGlobe();
    return Promise.all([
      new this.THREE.TextureLoader().loadAsync("/img/8k_earth_daymap.jpg"),
      new this.THREE.TextureLoader().loadAsync("/img/8k_earth_nightmap.jpg"),
    ]).then(([dayTexture, nightTexture]) => {
      this.globeMaterial = new this.THREE.ShaderMaterial({
        uniforms: {
          dayTexture: { value: dayTexture },
          nightTexture: { value: nightTexture },
          sunDirection: { value: new this.THREE.Vector3() },
        },
        vertexShader: DayNightShader.vertexShader,
        fragmentShader: DayNightShader.fragmentShader
      });
      // .bumpImageUrl('//cdn.jsdelivr.net/npm/three-globe/example/img/earth-topology.png');

      this.globe.globeMaterial(this.globeMaterial);

      // Setup renderer
      this.renderer = new this.THREE.WebGLRenderer();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      this.globeVizEl = document.getElementById('globeViz');
      this.globeVizEl.appendChild(this.renderer.domElement);
  
      const resizeObserver = new ResizeObserver(entries =>
      {
        const { width, height } = entries[0].contentRect;
  
        this.renderer.domElement.style.width = "100%";
        this.renderer.domElement.style.height = "100%";
  
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(width, height, false);

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
      });
      resizeObserver.observe(this.globeVizEl);

      // Setup scene
      this.scene = new this.THREE.Scene();
      this.scene.add(this.globe);
      this.scene.add(new this.THREE.AmbientLight(0x808080, Math.PI));
      this.scene.add(new this.THREE.DirectionalLight(0xffffff, 0.6 * Math.PI));

      // Setup camera
      this.camera = new this.THREE.PerspectiveCamera();
      this.camera.aspect = window.innerWidth/window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.camera.position.z = 200;

      // Add camera controller
      this.trackball = new this.TrackballControls(this.camera, this.renderer.domElement);
      this.trackball.minDistance = 101;
      this.trackball.rotateSpeed = 5;
      this.trackball.zoomSpeed = 0.8;
    });
  }

}