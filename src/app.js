import {Rumble} from "./rumble.js";
import { HzBridge } from "./hzbridge.js";

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
    this.camera.position.z = 500;

    // Add camera controller
    this.trackball = new this.TrackballControls(this.camera, this.renderer.domElement);
    this.trackball.minDistance = 101;
    this.trackball.rotateSpeed = 5;
    this.trackball.zoomSpeed = 0.8;
  }

}