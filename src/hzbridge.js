// a bridge to the HzWeb sandbox:
// 
//  -- create iframe on the HzWeb/sandbox/index.html. 
//  -- establish/maintain IPC with sandbox.
//  -- ensure sandbox is initialized for MusicAPI (incl plugins)
// 

import {HzSbCtx} from "./hzsbctx.js";
import {HzEventHub} from "./hzeventhub.js";

// const sbURL = "http://localhost:8081/sandbox/index.html?sbId=0";
const sbURL = "https://cannerycoders.com/apps/HzWeb/sandbox/index.html?sbId=0";

export class HzBridge extends HzEventHub
{
  constructor(div)
  {
    super();
    this.iframeDiv = div;
    this.sandboxes = [];

    this.iframeDiv.innerHTML = `
    <iframe style="border-style:none" tabindex="10" 
     sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox">
    </iframe>
    `;

    this.iframe = this.iframeDiv.querySelector("iframe");
    this.iframe.addEventListener("load", () =>
    {
      this.newSandbox();
      // nb; we can't access sandbox content directly
    });

    this.iframe.src = sbURL;
    this.sbWin = this.iframe.contentWindow;
  }

  EvalScript(scriptContent)
  {
    const mode = "async";
    let type = "runscript";
    let payload = {content: scriptContent, mode};
    let sbIndex = 0;
    let sb = this.sandboxes[sbIndex];
    sb.Send(type, payload);
  }

  Notify(msg, payload)
  {
    let sbIndex = 0;
    let sb = this.sandboxes[sbIndex];
    sb.Send(msg, payload);
  }

  /* ------------------------------------------------------------- */
  newSandbox()
  {
    let sbid = this.sandboxes.length;
    let ctx = new HzSbCtx(this, sbid, this.sbWin, () =>
    {
      this.Emit("HzReady");
    });
    this.sandboxes.push(ctx);
    ctx.InitComms();
  }

}