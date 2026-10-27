import {contentDifferences} from './diff.js';
self.onmessage=event=>{try{const {left,right,options}=event.data;self.postMessage({results:contentDifferences(left,right,options)})}catch(error){self.postMessage({error:error.message||String(error)})}};
