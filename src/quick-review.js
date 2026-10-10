export function reviewCues(c){
 const f=c.appFeedback?.original;
 const triggers=f?.triggers?.length?f.triggers:f?.trigger?[f.trigger]:[];
 return triggers.slice(0,2).map(t=>({key:`${t.key}:${Math.sign(t.delta)}`,text:f.text?.ja?.split('、')[triggers.indexOf(t)]??t.label??t.key}));
}
export function quickLabels(c,judgment){
 return {...c.labels,detection:'correct',voiceJudgment:judgment,cueLabels:Object.fromEntries(reviewCues(c).map(t=>[t.key,judgment==='correct'?'correct':judgment==='incorrect'?'incorrect':'unknown']))};
}
export function voiceReviewed(c){
 if(['good','too-high','too-low'].includes(c.labels.submetrics?.release)||['good','too-deep','too-shallow'].includes(c.labels.submetrics?.dip))return true;
 if(c.labels.feedbackRating==='bad')return !!c.appFeedback?.original&&c.appFeedback.original.speak!==false;
 if(c.labels.voiceJudgment!==undefined)return !!c.appFeedback?.original&&c.appFeedback.original.speak!==false&&(['correct','incorrect'].includes(c.labels.voiceJudgment)||c.labels.voiceJudgment==='partial'&&Object.values(c.labels.cueLabels??{}).some(v=>v!=='unknown'));
 return ['useful','bad','inaccurate','repetitive'].includes(c.labels.feedbackRating);
}
export function audioStatus(c){
 if(c.source.mode!=='live')return '（画面の助言）';
 if(c.appFeedback?.original?.speak===false)return '（音声なし・画面の助言）';
 if(c.appFeedback?.original?.speak!==true)return '（発話記録なし）';
 return '';
}
