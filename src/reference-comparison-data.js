// Compact historical snapshots omit Pose/ball frames. Only reuse analysis from
// the same saved reference when all available identity fields agree. Never
// silently substitute a newly scored reference for a historical comparison.
export function referenceComparison(snapshot, original, saved){
 if(original?.frames?.length)return {analysis:original,reason:'比較時の保存分析'};
 const matches=a=>a&&snapshot&&['version','analyzedAt','phases','metrics'].every(k=>snapshot[k]===undefined||JSON.stringify(snapshot[k])===JSON.stringify(a[k]));
 if(matches(saved)&&saved.frames?.length)return {analysis:{...snapshot,frames:saved.frames,ballTracking:saved.ballTracking,aspect:snapshot.aspect??saved.aspect},reason:'同じ基準動画の保存姿勢を使用'};
 return {analysis:original??snapshot??{},reason:saved?.frames?.length?'比較時と現在の分析が異なるため姿勢を流用しません':'基準フォームの保存姿勢がありません'};
}
