export const AnyEvent = "any";

export class HzEventHub 
{
  constructor()
  {
    this.m_subs = {};
    this.m_subs[AnyEvent] = [];
  }

  /**
   * Add a new event listener
   * 
   * @param {string} evt event name
   * @param {*} cb  required callback
   * @param {*} ctx  optional ctx
   */
  On(evt, cb, ctx)
  {
    if(!this.m_subs[evt])
      this.m_subs[evt] = [];
    this.m_subs[evt].push({ cb, ctx });
  }

  /**
   * Remove one or all event listeners
   * 
   * @param {string} evt  event name 
   * @param {*} cb optional callback
   * @param {*} ctx optional callback
   */
  Off(evt, cb, ctx)
  {
    let elist = this.m_subs[evt];
    if(!elist)
      throw new Error(`No subs for event ${evt}`);
    let found = false;
    for(let i = 0; i < elist.length; i++)
    {
      if((!cb || elist[i].cb === cb) &&
        (!ctx || ctx === elist[i].ctx))
      {
        elist.splice(i, 1);
        found = true;
      }
    }
    if(found === false)
      throw new Error(`Nothing to unbind for ${evt}`);
  };

  HasSubs(evt=null)
  {
    if(evt)
    {
      let subs = this.m_subs[evt];
      if(subs) 
        return subs.length > 0;
      else 
        return false;
    }
    else
    {
      if(this.m_subs[AnyEvent].length) 
        return true;
      if(Object.keys(this.m_subs).length > 1) 
        return true;
      return false;
    }
  }

  /**
   * @param {*} evt 
   * @param  {...any} args 
   * @returns number of deliveries
   */
  Emit(evt, ...args)
  {
    let n=0;
    let subs = this.m_subs[evt];
    if(subs)
    {
      for(let sub of subs)
      {
        if(sub.ctx)
          sub.cb(sub.ctx, ...args);
        else
          sub.cb(...args);
        n++;
      }
    }

    var anys = this.m_subs[AnyEvent];
    if(anys)
    {
      for(let sub of anys)
      {
        if(sub.ctx)
          sub.cb(sub.ctx, ...args);
        else
          sub.cb(...args);
        n++;
      }
    }
    return n;
  }
}
