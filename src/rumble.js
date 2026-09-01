export class Rumble
{
  constructor(globe, three, camera, trackball)
  {
    this.URLS = 
    {
    significant:
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_hour.geojson',
    m45:
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_hour.geojson',
    m25:
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_hour.geojson',
    m10:
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/1.0_hour.geojson',
    all:
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson'
    };

    this.globe = globe;
    this.three = three;
    this.camera = camera;
    this.trackball = trackball;
    this.globe
    .ringMaxRadius('maxR')
    .ringPropagationSpeed('propagationSpeed')
    .ringRepeatPeriod('repeatPeriod')
    .ringColor((q)=>
    {
      return `hsla(${q.hue}, 100%, 50%, 1)`;
    });

    this.knownQuakes = new Set(); // just ids, so no worries about clearing
    this.activeQuakes = []; // list of active quakes, sorted newest to oldest
    this.idleInterval = 60 * 1000 * 2; // 2 min
    this.onIdleCB = this.onIdle.bind(this);
    this.onIdle();
  }

  onIdle()
  {
    this.pollQuakes();
    setTimeout(this.onIdleCB, this.idleInterval);
  }

  async pollQuakes()
  {
    const response = await fetch(this.URLS.all);
    if(!response.ok) throw new Error(`USGS: HTTP ${response.status}`);
    const data = await response.json();
    let arrived = false;
    for(const event of data.features)
    {
      if(!this.knownQuakes.has(event.id))
      {
        this.knownQuakes.add(event.id);
        this.earthquakeArrived(event);
        arrived = true;
      }
    }
    if(arrived)
    {
      const now = Date.now();
      this.activeQuakes.filter((q) => 
      {
        let delta = now - q.staleTime;
        let live = delta <= 0;
        if(!live)
        {
          console.log(`${q.event.properties.place} stale ${q.time} ${delta/1000}`);
        }
        return live;
      });
      this.globe.ringsData(this.activeQuakes);
      // flyTo
    }
  }

  /* ---------------------------------------------------------- */
  /*
      usgs: {
        id: event.id,
        magnitude: event.properties.mag,
        sig: event.properties.sig,
        place: event.properties.place,
        time: quakeDate.toLocaleString(),
        depth // km
      },
  */
  earthquakeArrived(event)
  {
    const [longitude, latitude, depth] = event.geometry.coordinates;
    const radius = this.magDepthToRadiusDegrees(event.properties.mag, depth)
    let quakeDate = new Date(event.properties.time);
    let quakeTime = quakeDate.getTime(); // ms
    let staleTime = quakeTime + this.lifetimeMillis(event.properties.mag);
    this.activeQuakes.push(
    {
      event, 
      time: quakeDate.toLocaleString(),
      quakeTime,
      staleTime,
      hue: this.sigToHue(event.properties.sig),
      // for rings
      lat: latitude,
      lng: longitude,
      maxR: radius, // expressed in angular degrees
      propagationSpeed: 1,
      repeatPeriod: 500, // ms
    });
  }

  sigToHue(sig)
  {
    let x = Math.min(1, sig/1000);
    return 240 * (1 - x); // blue is 240 red is 0
  }

  // eg: M4 survives roughly an hour, 
  //    M5 ~4 hours, 
  //    M6 ~7 hours, 
  //    M7 ~10 hours, 
  lifetimeMillis(mag)
  {
    const hours = 1 + 3 * Math.max(0, mag - 4);
    return hours * 60 * 60 * 1000;
  }

  /* ---------------------------------------------------------
  | Magnitude |   Radius | Approx. miles |
  | --------: | -------: | ------------: |
  |         4 |     0.9° |         62 mi |
  |         5 |     1.8° |        125 mi |
  |         6 |     3.6° |        249 mi |
  |     **7** | **7.2°** |    **498 mi** |
  |         8 |    14.4° |        996 mi |
  |         9 |    28.8° |      1,992 mi |
  */
  magToRadiusDegrees(mag, scale=1)
  {
    // Approximately 500 miles / 7.2 degrees at M7.
    //
    // Every magnitude unit increases the radius by ~2x.
    return scale * 7.2 * Math.pow(2, magnitude - 7);
  }

  magDepthToRadiusDegrees(magnitude, depthKm, scale=10)
  {
    const earthCircumferenceMiles = 24901;
    const radiusAtM7Miles = 500;

    // Magnitude effect:
    const magnitudeRadius = radiusAtM7Miles * Math.pow(2, magnitude - 7);

    // Depth attenuation.
    // Shallow earthquakes are largely unaffected;
    // deeper earthquakes have progressively smaller
    // surface influence.
    const depthFactor = 1 / Math.sqrt(1 + depthKm / 20);
    const radiusMiles = magnitudeRadius * depthFactor;
    return scale * radiusMiles * 360 / earthCircumferenceMiles;
  }

  flyTo(globe, three, camera, lat, lng, duration = 1000)
  {
    const p = globe.getCoords(lat, lng, 1);
    const target = new three.Vector3(p.x, p.y, p.z).normalize();
    const cameraDirection = camera.position.clone().normalize();
    // Target in world coordinates.
    const worldTarget = target.clone().applyQuaternion(globe.quaternion);

    // Rotation axis for the shortest great-circle rotation.
    const axis = new THREE.Vector3().crossVectors(worldTarget, cameraDirection);
    const axisLength = axis.length();

    // Already centered.
    if (axisLength < 1e-6) return;

    axis.normalize();

    const angle = Math.acos(
      three.MathUtils.clamp(worldTarget.dot(cameraDirection), -1, 1));

    const startQuaternion = globe.quaternion.clone();
    const startTime = performance.now();

    function animate(now)
    {
      const t = Math.min(1, (now - startTime) / duration);

      // Smoothstep.
      const s = t * t * (3 - 2 * t);

      const rotation = new THREE.Quaternion().setFromAxisAngle(axis, angle * s);

      globe.quaternion.copy(startQuaternion).premultiply(rotation);

      if (t < 1)
        requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
  }

  /*
  async queryQuakes() // currently unused
  {
    const end = new Date();
    const start = new Date(end.getTime() - 60 * 60 * 1000);
    const params = new URLSearchParams(
      {
        format: 'geojson',
        starttime: start.toISOString(),
        endtime: end.toISOString(),

        // USGS significance threshold.
        // 0 = everything, 1000 = extremely significant.
        minsig: '100',
        orderby: 'time-asc'
      });

    const url =
      `https://earthquake.usgs.gov/fdsnws/event/1/query?${params}`;

    const response = await fetch(url);

    if (!response.ok)
      throw new Error(`USGS request failed: ${response.status}`);

    const data = await response.json();

    return data.features.map(event => ({
      id: event.id,

      time: new Date(event.properties.time),
      magnitude: event.properties.mag,
      magnitudeType: event.properties.magType,

      significance: event.properties.sig,

      place: event.properties.place,

      // GeoJSON: [longitude, latitude, depth]
      longitude: event.geometry.coordinates[0],
      latitude: event.geometry.coordinates[1],
      depthKm: event.geometry.coordinates[2],

      tsunami: event.properties.tsunami === 1,
      url: event.properties.url
    }));
  }
  */
}