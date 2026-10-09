export const SESSION_RATINGS={accurate:'正確',inaccurate:'不正確',unknown:'わからない'};
export const SESSION_FEEDBACK_ITEMS={dip:'ディップの認識',release:'リリースの認識',trunk:'体幹の判定（推定）',detection:'シュート検出',voice:'音声の役立ち度'};
export function validateSessionRating(value){
 if(!value||value.schema!=='session-rating-1'||typeof value.sessionId!=='string'||!Number.isFinite(value.updatedAt)||!Number.isFinite(value.createdAt)||typeof value.note!=='string'||value.note.length>2000||!value.ratings||typeof value.ratings!=='object'||Array.isArray(value.ratings)||Object.entries(value.ratings).some(([k,v])=>!Object.hasOwn(SESSION_FEEDBACK_ITEMS,k)||!Object.hasOwn(SESSION_RATINGS,v))||!Array.isArray(value.scoreVersions)||value.scoreVersions.some(v=>typeof v!=='string'||v.length>200)||!Array.isArray(value.analysisVersions)||value.analysisVersions.some(v=>typeof v!=='string'||v.length>200)||typeof value.condition!=='string'||value.condition.length>2000||!(value.basis===null||typeof value.basis==='string'&&value.basis.length<=50000)||typeof value.sourceVersion!=='string')throw new Error('セッション評価の形式が不正です');
 return value;
}
export function ratingEntry(session,previous,ratings,note,condition,basis,now=Date.now()){
 const batchRating=validateSessionRating({schema:'session-rating-1',sessionId:session.id,createdAt:previous?.batchRating?.createdAt??now,updatedAt:now,ratings:{...ratings},note,condition,basis,scoreVersions:[...new Set(session.shots.map(s=>s.scoreVersion??s.comparison?.version??'unknown'))],analysisVersions:[...new Set(session.shots.map(s=>s.analysis?.version??'unknown'))],sourceVersion:session.version??'unknown',calibrationVersionId:session.calibrationVersionId??null});
 return {...previous,mode:'live',recordId:session.id,title:session.goodFormReference?.title??'Live Coach',appFeedback:previous?.appFeedback??{text:'セッション単位の弱いフィードバック'},comments:previous?.comments??[],batchRating};
}
