// nb: within QuakeSonify, "this" refers to the function object
// and not the fiber context object.
async function *QuakeSonify(sbctx)
{
  /* ------------------------------------------------------ */
  // this class is used to serialize incoming IPC requests.
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
      if (this.running) return;
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
  /* --------------------------------------------------------------- */
  // we use GenFM2 rather than FM7 because we want long sustained notes.
  function GenFM2(g, nvoices = 10) 
  {
    function oneVoice(g)
    {
      let freq = g.param(0);
      let harmonicity = g.param(0);
      let modIndex = g.param(0);
      // A ~= 2 ^ ((0-99)/8), to produce a range of 0-<20
      let env = g.adsr(0, 0, 0, 0);
      let modEnv = g.adsr(0, 0, 0, 0);
      let modFreq = g.mul(freq, harmonicity);
      // let modAmount = g.mul(modIndex, modFreq);
      let modOsc = g.cycle(modFreq);
      let fm = g.add(freq, g.mul3(modEnv, modIndex, modOsc));
      let osc = g.sin(fm);
      let velocity = .8; // not a param, so more efficiently triggered.
      let monosynth = g.mul3(env, osc, velocity);
      return g.voice(monosynth,
      {
        _triggers: {
          onoff: [
            {idx: env.getTriggerIdx()},
            {idx: modEnv.getTriggerIdx()},
          ],
          frequency: [
            {idx: freq.getValueIdx()},
          ],
          velocity: [
            {idx: monosynth.getParamPokeIdx("2")},
          ]
        },
        A: {idx: env.getParamPokeIdx("_attack"), unit:"timecoeff"},
        D: {idx: env.getParamPokeIdx("_decay"), unit:"timecoeff"},
        S: {idx: env.getParamPokeIdx("_sustain")},
        R: {idx: env.getParamPokeIdx("_release"), unit:"timecoeff"},
  
        // FM
        Harmonicity: {idx: harmonicity.getValueIdx()},
        ModIndex: {idx: modIndex.getValueIdx()},
        ModA: {idx: modEnv.getParamPokeIdx("_attack"), unit:"timecoeff"},
        ModD: {idx: modEnv.getParamPokeIdx("_decay"), unit:"timecoeff"},
        ModS: {idx: modEnv.getParamPokeIdx("_sustain")},
        ModR: {idx: modEnv.getParamPokeIdx("_release"), unit:"timecoeff"},
      }); 
    }

    // short ModA, long ModR
    let voices = [];
    g.param(.25, "VGain", {min:0, max:1, default:.25});
    g.param(.5, "VPan", {min:0, max:1, default:.5});
    g.param(.2, "A", {min:.01, max:5, default:.2, 
            group:"Env", groupbgd:"#321"});  // seconds
    g.param(.5, "D", {min:0, max:5, default:.5, group:"Env"}); // seconds
    g.param(.8, "S", {min:0, max:1, default:.8, group:"Env"});
    g.param(3, "R", {min:0, max:5, default:3, group:"Env"}); // seconds
    g.param(.3, "Harmonicity", {
      label:"Ratio", delta: .1, max: 10, min: .1, default: .3, 
      group: "FM", groupbgd: "rgb(17, 44, 34)"});
    g.param(20, "ModIndex", {delta: .1, max: 20, min: .1, default: 20, group: "FM"});
    g.param(.01, "ModA", {delta:.05, min:.01, max: 10, default: 1, group:"FM"});
    g.param(.1, "ModD", {delta:.05, max: 10, group:"FM"});
    g.param(1, "ModS", {min:0, max:1, default:1, group:"FM"});
    g.param(2, "ModR", {min:0, max:5, default:2, group:"FM"});
    for (let i = 0;i < nvoices;i++)
      voices.push(oneVoice(g));
    return g.voicemgr({voices});
  }

  /* --------------------------------------------------------------- */
  const showOsc = true;
  const showNoiseMix = true;
  const showNoiseVoice = false;
  const showAlert = false;
  const showGraph = false;

  const skipNoise = false;
  const skipOsc = false;

  // console.log("Running QuakeSonify");

  let scene = await Ascene.BeginFiber(sbctx);
  let dac = scene.GetDAC();
  await dac.LoadPreset({
    Gain: .6
  });
  dac.Show();

  let sscope = await Anode.New("Hz.SpectreScope", {name:"QuakeScope"});
  scene.Chain(sscope, dac);
  sscope.Show();

  let compress = await Anode.New("Hz.DynaCompress", {
    name:"Compressor",
    preset: {
      Threshold: -1,
      Knee: 3,
    }
  });
  scene.Chain(compress, sscope);
  compress.Show();

  let out = compress;

  let osc = await Anode.New("Hz.Osc", {
    preset: {
      Waveform: 0, // sine
      Gain: 1,
      A: 5,
      D: .01,
      S: 1,
      R: 5,
      Unison: 3,
      Spread: 1,
      Detune: .3
    }
  });
  let oscmix = await Anode.New("Hz.Mix", {
    name: "Tone",
    preset: {
      Gain: .14 
    }
  });

  if(showOsc)
    oscmix.Show();

  let qmix = await Anode.New("Hz.Mix", {
    name: "Rumble",
    preset: {
      Gain: 2.5
    }
  });
  if(showNoiseMix)
    qmix.Show();

  // let alert = await Anode.New("Hz.FM7", {
  //   preset: {
  //     Bank: 2,
  //     Patch: 2, // SCHLBELL
  //     Gain: 1.5
  //   }
  // });
  let alert = await scene.NewAnode("Hz.Genish", {name: "Alert"});
  await alert.LoadPreset({genish: {
    name: "fm2",
    code: GenFM2.toString(), 
  }});
  if(showAlert)
    alert.Show();

  scene.Chain(osc, oscmix, out);
  scene.Chain(alert, out);
  scene.Chain(qmix, out);

  const quakeCtx = 
  {
    activeQuakes: [],
    inactiveQuakes: [],
    osc,
  };

  function assignNoteAttributes(q)
  {
    q.note = 14 + globalThis.Random.Choose([20, 22, 24, 26, 28, 32, 36, 40, 44])
    q.velocity = 1; 
  }

  async function playAlert(maxMag)
  {
    // console.log(`alert ${maxMag} -> ${vel}`);
    let nnotes = Math.round(maxMag); 
    const vel = Math.min(maxMag/6, 1);
    const interval = scene.Seconds(5) / nnotes;
    const dur = scene.Seconds(1);
    for(let n=0;n<nnotes;n++)
    {
      // alert.Note(45+2*n, vel, dur, 0);
      alert.Note(47, vel, dur, 0);
      await scene.Wait(interval*1.05);
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
            Pan: .5, 
            Gain: 1, // modified below
          }});
        if(showNoiseVoice)
          mix.Show();
        scene.Chain(noise, f1, mix);
        scene.Chain(noise, f2, mix);
        scene.Chain(noise, f3, mix);
        scene.Chain(mix, qmix);
        if(showGraph)
        {
          if(quakeCtx.showTimeout == null)
            clearTimeout(quakeCtx.showTimeout);
          quakeCtx.showTimeout = setTimeout(() =>
          {
            scene.VisualizeGraph("Quake");
            quakeCtx.showTimeout = null;
          });
        }
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
    let qgain = .5 + 3 * qevent.properties.mag/7;
    let pan = 2*Math.random() - 1; // mix's pan is -1,1
    if(q.noise)
    {
      q.mix.SetParam("Pan", pan), // mix's pan is -1,1
      q.mix.SetParam("Gain", qgain);
      q.noise.NoteOn(30, 1); // noise: note is ignored
    }
    if(!skipOsc)
    {
      quakeCtx.osc.SetParam("Pan", pan); // osc pan is -1,1 
      q.noteId = quakeCtx.osc.NoteOn(q.note, q.velocity)[0];
      // XXX: apply per-note expression for pan.
    }
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

const src = QuakeSonify.toString();

// we take this approach in order to get full IDE feedback
// on the function above.  Alternative is to return it as a 
// raw code-block.
export const RunQuakeSonify = `
  let fn = (${src});

  for await (const val of fn(this))
    yield;
`