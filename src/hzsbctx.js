/* ---------------------------------------------------------------- */
export class HzSbCtx
{
  constructor(eventhub, sbId, sbWin, onReady)
  {
    this.eventhub = eventhub;
    this.sbId = sbId;
    this.ready = false;
    this.sbWin = sbWin,
    this.msgChannel = new MessageChannel();;
    this.msgPort = this.createStructuredPort(this.msgChannel.port1);
    this.activeQueries = {};
    this.queryId = 0;

    // first install our handlers -------------------
    this.on("ready", (payload) =>
    {
      if (payload.id != this.sbId)
        console.warn(`SandboxMgr.ready botch ${payload.id} ${this.sbId}`);
      if (onReady)
      {
        onReady(this.sbId, this.sbWin);
      }
    });
    this.on("emit", (payload) =>
    {
      this.eventhub.Emit(payload.emitId, payload.payload);
    });
    this.on("log", (payload) =>
    {
      console[payload.lev](payload.msg);
    });
    this.on("queryresult", (payload) =>
    {
      let {queryId, result, err} = payload;
      let {resolve, reject} = this.activeQueries[queryId];
      if (!resolve) 
        console.warn(`sbmgr: invalid queryresponse received ${queryId}`);
      else
      {
        if (err != null)
          reject(err);
        else
          resolve(result);
        delete this.activeQueries[queryId];
      }
    });
    this.on("localfetch", (payload) =>
    {
      App.FetchLocalFile(payload.url, payload.filetype)
        .then((contents) =>
        {
          let text, buffer;
          if (payload.filetype == "arraybuffer")
            buffer = contents.buffer;
          else
            text = contents;
          const rpayload = { 
            reqId: payload.reqId, 
            err: 0,
            text,
            buffer
          };
          this.send("response", rpayload);
        })
        .catch((err) =>
        {
          const rpayload = { 
            reqId: payload.reqId, 
            err,
          };
          this.send("response", rpayload);
        });
      });
      this.on("WSSave", (payload) =>
      {
        App.SaveWorkspaceFile(payload.url, 
                  payload.data, 
                  payload.filetype,
                  payload.cfg)
          .then(() =>
          {
            const rpayload = { 
              reqId: payload.reqId, 
              err: 0,
            };
            this.send("response", rpayload);
          })
          .catch((err) =>
          {
            const rpayload = { 
              reqId: payload.reqId, 
              err,
            };
            this.send("response", rpayload);
          });
      });
      this.on("fibermgr/new", (payload) =>
      {
        this.eventhub.Emit("sbFiberStatus", this.sbId, payload);
    });
    this.on("fibermgr/status", (payload) =>
    {
      this.eventhub.Emit("sbFiberStatus", this.sbId, payload);
    });
    // nb: we send init msg only after we receive "sbReady", above.
  }

  /** 
   * request MessageChannel init handshake via standard/global postMessage.
    * NB: this can only be done after sbWin is "ready", meaning that it
    * has installed its 'message' event listener AND is
    */
  InitComms()
  {
    const msg = {
      type: "init", 
      sbId: this.sbId,
      port: this.msgChannel.port2,
      showActivate: true,
    };
    this.sbWin.postMessage(msg, "*",
      [this.msgChannel.port2] // must transfer ownership
    );
  }

  /* ----------------------------------------------------------------- */
  send(type, payload, queryctx = null) 
  {
    if (type == "runquery")
    {
      payload.queryId = "q" + this.queryId++;
      this.activeQueries[payload.queryId] = queryctx;
    }
    this.msgPort.send(type, payload);
  }
  on(type, handler)
  {
    this.msgPort.on(type, handler); 
  }
  close()
  {
    console.warn("HzSbCtx close?");
    if (!this.sbWin.closed) 
      this.sbWin.close();
  }
  /* Construct a uniform interface around a port associated 
    * with a MessageChannel (port1 is host, port2 is sandbox). 
    * NB: this function may be webpacked into sandbox code.
    * @returns object with "send" and "on" methods.
    */
  createStructuredPort(port) 
  { 
    const listeners = new Map();
    port.onmessage = (e) => 
    {
      const {type, payload} = e.data;
      if (listeners.has(type)) 
        listeners.get(type)(payload);
      else
        console.log("Unknown IPC msg " + type);
    };
    return {
      send(type, payload) 
      {
        port.postMessage({type, payload});
      },
      on(type, handler) 
      {
        listeners.set(type, handler);
      }
    };
  }
}