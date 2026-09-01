import * as THREE from "three";
import ThreeGlobe from "three-globe";
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js?external=three";

import { App } from './app.js';

new App(THREE, ThreeGlobe, TrackballControls);