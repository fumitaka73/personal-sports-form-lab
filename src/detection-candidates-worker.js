import {iterateChunks} from './pose-archive.js';
import {scanCandidates} from './detection-candidates.js';
self.onmessage=e=>{try{self.postMessage({result:scanCandidates(iterateChunks(e.data.chunks,e.data.origin),e.data.session)});}catch(error){self.postMessage({error:error.message});}};
