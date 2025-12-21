

import { Copy } from "@phosphor-icons/react";

interface CopyButtonProps {
    content: string | object | (() => string | object);
    className?: string;
    showToast?: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
    successMessage?: string;
    errorMessage?: string;
}

/**
content can be string, or an object (will convert as json), or a function (will call and then convert)
*/
export default function CopyButton({
    content, 
    className='btn btn-outline-secondary btn-sm',
    showToast,
    successMessage = 'Copied to clipboard!',
    errorMessage = 'Failed to copy to clipboard'
}: CopyButtonProps) {
    const doCopy = async () => {
        try {
            // lazy stringify
            let s;
            let contentValue = content;
            if (typeof(contentValue) === 'function')  {
                contentValue = contentValue();
            }
            if (typeof(contentValue) === 'string') {
                s = contentValue;
            } else {
                s = JSON.stringify(contentValue);
            }
            await navigator.clipboard.writeText(s);
            if (showToast) {
                showToast(successMessage, 'success');
            }
        } catch (err) {
            console.error('Failed to copy:', err);
            if (showToast) {
                showToast(errorMessage, 'error');
            }
        }
    };
   return <button className={className}
   onClick={doCopy} title='Copy to clipboard'><Copy size={16} /></button>;
}