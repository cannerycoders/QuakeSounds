// a bridge to the HzWeb sandbox:
// 
//  -- create iframe on the HzWeb/sandbox/index.html. 
//  -- establish/maintain IPC with sandbox.
//  -- ensure sandbox is initialized for MusicAPI (incl plugins)
// 

import {HzSbCtx} from "./hzsbctx.js";
import {HzEventHub} from "./hzeventhub.js";

export class HzBridge extends HzEventHub
{
  constructor(div)
  {
    super();
    this.iframeDiv = div;
    this.iframeDiv.innerHTML = `
    <iframe tabindex="10" sandbox="allow-same-origin allow-scripts"></iframe>
    `;
    this.iframe = this.iframeDiv.querySelector("iframe");
    this.iframe.src = "https://cannerycoders.com/apps/HzWeb/sandbox/index.html";
    this.sbWin = this.iframe.contentWindow;
    this.content = this.sbWin.document.querySelector(".Content");
    this.sandboxes = [];

    window.addEventListener("message", evt => 
    {
      if (evt.origin != window.location.origin)
      {
        console.warn("Unexpected message source " + evt.origin);
        return;
      }
      switch (evt.data.type)
      {
      case "sbReady":
        {
          let sbId = evt.data.sbId;
          let sbCtx = this.sandboxes[sbId];
          if (!sbCtx)
            console.warn("SandboxMgr received ready from an unknown sandbox:" + sbId);
          else
            sbCtx.initComms();
        }
        break;
      }
    });
    this.newSandbox();
  }

  newSandbox()
  {
    let sbid = this.sandboxes.length;
    let ctx = new HzSbCtx(this, sbid, this.sbWin);
    this.sandboxes.push(ctx);
    this.Emit("sbCreate", sbid);
    ctx.initComms();
  }

  initComms()
  {
    const msg = {
      type: "init", 
      sbId: this.sbId,
      port: this.msgChannel.port2
    };
    // must transfer ownership of port2
    this.sbWin.postMessage(msg, "*", [this.msgChannel.port2]);
  }

}