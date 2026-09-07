import {Rumble} from "./rumble.js";
import { HzBridge } from "./hzbridge.js";
import { QuakeSonify, RunQuakeSonify } from "./sonify.js";

export class App
{
  constructor(THREE, ThreeGlobe, TrackballControls)
  {
    this.hzbridge = new HzBridge(document.getElementById("hzbridge"));

    this.THREE = THREE;
    this.ThreeGlobe = ThreeGlobe;
    this.TrackballControls = TrackballControls;

    this.initGlobe();
    this.quakeInfo = document.getElementById("quakeInfo");
    this.rumble = new Rumble(this.globe, 
                  this.THREE, this.camera, 
                  this.trackball, this.quakeInfo);
    this.redrawCB = this.redraw.bind(this);
    this.redraw();

    window.App = this;
    this.soundActivated = false;
    this.pendingQuakes = [];
    this.hzbridge.On("HzSbActivate", (onoff) =>
    {
      if(this.soundActivated == false)
      {
        let fstr = QuakeSonify.toString() + RunQuakeSonify.toString();
        this.hzbridge.EvalScript(fstr);
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
    this.rumble.On("SimQuake", (mag, lat, lng, sig=300) =>
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
          sig: sig,
          place: "10 klicks away from No Place, WA."
        }
      };
      this.rumble.earthquakeArrived(event);
      this.rumble.onNewQuake(mag);
    });
    this.rumble.On("FlyTo", (info) =>
    {
      console.log("flyto", Object.keys(info));
    });
  }

  async FetchLocalFile(fileref, filetype="text")
  {
    throw new Error("File not found " + fileref);
  }

  redraw()
  {
    this.trackball.update();
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.redrawCB);
  }

  initGlobe()
  {
    this.globe = new this.ThreeGlobe()
      //.globeImageUrl('//cdn.jsdelivr.net/npm/three-globe/example/img/earth-day.jpg')
      .globeImageUrl('/img/8k_earth_daymap.jpg')
      .bumpImageUrl('//cdn.jsdelivr.net/npm/three-globe/example/img/earth-topology.png');

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
  }

}