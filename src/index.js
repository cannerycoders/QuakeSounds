import * as THREE from "three";
import ThreeGlobe from "three-globe";
import { TrackballControls } from "TrackballControls";
import * as solar from "solar-calculator";

import { App } from './app.js';

new App(THREE, ThreeGlobe, TrackballControls, solar);