

import { Copy } from "@phosphor-icons/react";
/**
content can be string, or an object (will convert as json), or a function (will call and then convert)
*/
export default function CopyButton({content, className='btn btn-secondary'}) {
    const doCopy = () => {
        // lazy stringify
        let s;
        if (typeof(content) === 'function')  {
            content = content();
        }
        if (typeof(content) === 'string') {
            s = content;
        } else {
            s = JSON.stringify(content);
        }
        navigator.clipboard.writeText(s);
    };
   return <button className={className} 
   onClick={doCopy} title='Copy to clipboard'><Copy /></button>;
}