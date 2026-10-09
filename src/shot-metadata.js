export const pointLabel=value=>value==='2pt'?'2ポイント':value==='3pt'?'3ポイント':'ポイント未指定';
export const pointValue=value=>['2pt','3pt'].includes(value)?value:'unspecified';
