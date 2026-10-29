import {contentDifferences} from './diff.js?v=20261029-8';
self.onmessage=event=>{try{const {left,right,options}=event.data;self.postMessage({results:contentDifferences(left,right,options)})}catch(error){self.postMessage({error:error.message||String(error)})}};
