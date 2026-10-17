import type {Asset,MarketingClient} from '../core/index.js';

/** Retained campaign artwork. Selection changes local material; the host owns
 * saving that revision and all later preparation/launch authority. */
export function CampaignMedia({assets,assetIds,client,disabled=false,selectionUnavailable,onSelect}:{
  assets:Asset[];assetIds:string[];client:MarketingClient;disabled?:boolean;
  selectionUnavailable?:string;onSelect:(assetId:string)=>void;
}){
  return <section aria-label="Campaign artwork">
    {selectionUnavailable&&<p>{selectionUnavailable}</p>}
    <div className="grid assets">{assets.map(a=><section className="card" key={a.id}>
      <div className="eyebrow">{a.source} · {a.kind}</div>
      {a.kind==='video'?<video controls preload="metadata" src={client.assetUrl(a.id)}/>:
        a.kind==='image'?<img src={client.assetUrl(a.id)} alt="Retained campaign creative"/>:
          <a href={client.assetUrl(a.id)}>Read storyboard</a>}
      <p>{a.width&&`${a.width} × ${a.height}`} {a.seconds&&`${a.seconds}s`} · v{a.version}</p>
      {a.kind==='image'&&<button type="button" className="secondary"
        disabled={disabled||Boolean(selectionUnavailable)||!a.rightsReceipt||assetIds.includes(a.id)}
        onClick={()=>onSelect(a.id)}>{assetIds.includes(a.id)?'Selected for campaign':'Use this image'}</button>}
      {a.kind==='video'&&<p className="muted">Playable retained output. Video ad placement is not supported by the initial single-image/Search mappings.</p>}
    </section>)}</div>
  </section>;
}
