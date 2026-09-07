// nb: within QuakeSonify, "this" refers to the function object
// and not the fiber context object.
export async function *QuakeSonify(ctx)
{
  const debugOsc = false;
  const debugNoise = false;
  const debug = debugOsc || debugNoise;
  const skipNoise = false;
  const skipOsc = false;
  if(debug) console.log("Running QuakeSonify");

  let scene = await Ascene.BeginFiber(ctx);
  let dac = scene.GetDAC();
  await dac.LoadPreset({
    Gain: .5
  });
  dac.Show();

  let fm7 = await Anode.New("Hz.FM7", {
    preset: {
      Bank: 0,
      Patch: 25, // TUB BELLS
      Gain: 1.5
    }
  });

  let osc = await Anode.New("Hz.Osc", {
    preset: {
      Waveform: 0, // sine
      Gain: .1,
      A: 5,
      D: .01,
      S: 1,
      R: 5,
      Unison: 3,
      Spread: 1,
      Detune: .3
    }
  });
  if(debugOsc)
    osc.Show();

  let sscope = await Anode.New("Hz.SpectreScope", {name:"QuakeScope"});
  sscope.Show();

  let out = sscope;
  if(out == dac)
    scene.Chain(osc, dac);
  else
    scene.Chain(osc, sscope, dac);

  scene.Chain(fm7, out);

  const quakeCtx = 
  {
    activeQuakes: [],
    inactiveQuakes: [],
    osc,
  };

  function assignNoteAttributes(q)
  {
    q.note = 14 + globalThis.Random.Choose([20, 22, 24, 26, 28, 32, 36, 40, 44])
    q.velocity = q.qevent.properties.mag / 8;
  }

  async function playAlert(maxMag)
  {
    console.log("alert: ", maxMag);
    const notes = [0,3,-12].map((v) => v + 50);
    const vel = Math.min(maxMag/6, 1);
    for(let n of notes)
    {
      fm7.Note(n, vel, scene.Seconds(5), 0);
      await scene.Wait(scene.Seconds(1.5));
    }
  }

  async function quakeOn(qevent)
  {
    console.log("quakeOn");
    let q;
    if(quakeCtx.inactiveQuakes.length == 0)
    {
      let noise, f1, f2, f3, mix;
      if(!skipNoise)
      {
        noise = await Anode.New("Hz.Noise", {
          acfg: {mode: "mono"},
          preset: {
            Waveform: 2, // brown
            Gain: 0.1, // three routes to dac
            A: 3,
            D: .01,
            S: 1,
            R: 5,
          }
        });
        const LFO = 1; // 
        f1 = await scene.NewAnode("Hz.Filter", {
          preset: {
            Type: 2, // bandpass
            Frequency: 50,
            Resonance: .8,
            Mix: 1,
            LFO,
            LFORate: .1,
            LFORange: 10,
          }});
        f2 = await scene.NewAnode("Hz.Filter", {
          preset: {
            Type: 2, // bandpass
            Frequency: 90,
            Resonance: .8,
            Mix: 1,
            LFO,
            LFORate: .2,
            LFORange: 5,
          }});
        f3 = await scene.NewAnode("Hz.Filter", {
          preset: {
            Type: 0, // lowpass
            Frequency: 200,
            Resonance: 0.5, 
            Mix: 1,
            LFO,
            LFORate: .12,
            LFORange: 5,
          }});
        mix = await scene.NewAnode("Hz.Mix", {
          acfg: {mode: "1to2"},
          preset: {
            Pan: 2*Math.random() - 1, // mix's pan is -1,1
          }
        });
        if(debugNoise)
          mix.Show();
        // scene.Chain(noise, out);
        scene.Chain(noise, f1, mix);
        scene.Chain(noise, f2, mix);
        scene.Chain(noise, f3, mix);
        scene.Chain(mix, out);
        if(debug)
          await scene.VisualizeGraph("Quake");
      }
      q = {
        noise,
        f1,
        f2,
        f3,
        mix,
      };
    }
    else
      q = quakeCtx.inactiveQuakes.pop();

    q.qevent = qevent; // quake.event
    console.log(`${qevent.id}: NoteOn`)
    quakeCtx.activeQuakes.push(q);

    assignNoteAttributes(q);
    q.noise?.NoteOn(30, 1); // noise: note is ignored
    if(!skipOsc)
      q.noteId = quakeCtx.osc.NoteOn(q.note, q.velocity)[0];
  }

  function quakeOff(qevent)
  {
    quakeCtx.activeQuakes = quakeCtx.activeQuakes.filter((q) =>
    {
      if(q.qevent.id == qevent.id)
      {
        console.log(`${qevent.id} NoteOff`);
        q.noise.NoteOff(30, 1);
        if(!skipOsc)
          quakeCtx.osc.NoteOff(q.note, 1, 0, q.noteId);
        quakeCtx.inactiveQuakes.push(q);
        return false;
      }
      else
        return true;
    });
  }


  console.log("Installing QuakeHandlers");
  class AsyncCommandQueue
  {
    constructor()
    {
      this.queue = [];
      this.running = false;
    }
    enqueue(command)
    {
      this.queue.push(command);
      this.drain();
    }
    async drain()
    {
      if (this.running)
        return;
      this.running = true;
      try
      {
        while (this.queue.length > 0)
        {
          const command = this.queue.shift();
          await command();
        }
      }
      finally
      {
        this.running = false;
      }
    }
  }

  let cmdQueue = new AsyncCommandQueue();
  SandboxCtx.IPC.On("QuakeMsg", (msg) =>
  {
    // console.log("QuakeMsg: " + JSON.stringify(msg));
    switch(msg.type)
    {
    case "QuakeOn":
      cmdQueue.enqueue(async () =>
      {
        await quakeOn(msg.quake);
      });
      break;
    case "QuakeOff":
      quakeOff(msg.quake);
      break;
    case "Alert":
      playAlert(msg.maxmag); // see app.js
      break;
    case "onCameraMove":
      break;
    case "idle":
      break;
    }
  });

  SandboxCtx.IPC.Notify("QuakeSonifyReady", {ready: true});

  while(true)
  {
    let msg = yield; // allows for external cancellation
    if(msg == "_cancel_") break;
    await scene.Wait(scene.Seconds(10));
    // console.log("sonify tick...");
  }

}

// we take this approach in order to get full IDE feedback
// on the function above.  Alternative is to return it as a 
// raw code-block.
export const RunQuakeSonify = `
  let gen = QuakeSonify(this/*fiberctx*/);
  for await (const val of gen)
  {
    yield;
  }
`