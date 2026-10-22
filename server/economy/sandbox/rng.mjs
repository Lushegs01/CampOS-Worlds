// Seeded, platform-independent pseudo-random numbers. Every draw an experiment makes comes from here, keyed
// by an explicit, persisted seed and a named stream, so a sweep over one parameter does not reshuffle the
// draws of unrelated inputs (common random numbers across policies and conditions).
export const hash32=s=>{let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0;}return h>>>0;};
export const mix32=x=>{x=(x+0x9e3779b9)>>>0;x=Math.imul(x^(x>>>16),0x85ebca6b)>>>0;x=Math.imul(x^(x>>>13),0xc2b2ae35)>>>0;return (x^(x>>>16))>>>0;};
/** mulberry32 seeded from (seed, stream). */
export function rng(seed,stream) {
 let a=mix32((seed>>>0)^hash32(stream));
 const next=()=>{a=(a+0x6d2b79f5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
 const int=(lo,hi)=>lo+Math.floor(next()*(hi-lo+1));
 return {next,int,
  pick:list=>list[Math.floor(next()*list.length)],
  weighted:pairs=>{let u=next();for(const [v,w] of pairs){if(u<w)return v;u-=w;}return pairs.at(-1)[0];},
  shuffle:list=>{const a=[...list];for(let i=a.length-1;i>0;i--){const j=Math.floor(next()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}};
}
/** A single reproducible uniform draw identified by its keys, independent of draw order. */
export const uniformAt=(seed,...keys)=>mix32((seed>>>0)^hash32(keys.join('|')))/4294967296;
