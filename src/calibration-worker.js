import {compareDetection,compareFeedback} from './personal-calibration.js';
self.onmessage=({data})=>{try{const {kind,sessions,cases,baseline}=data;const ready=sessions;const result=kind==='detector'?compareDetection(ready,cases,baseline):compareFeedback(cases,ready,baseline);self.postMessage({result});}catch(error){self.postMessage({error:error.message});}};
