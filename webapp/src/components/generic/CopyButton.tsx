

import { Copy } from "@phosphor-icons/react";

interface CopyButtonProps {
    content: string | object | (() => string | object);
    className?: string;
    size?: 'xs' | 'sm' | 'md' | 'lg';
    showToast?: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
    successMessage?: string;
    errorMessage?: string;
    logToConsole?: boolean;
}

/**
content can be string, or an object (will convert as json), or a function (will call and then convert)
*/
export default function CopyButton({
    content, 
    className='btn btn-outline-secondary btn-sm',
    size,
    showToast,
    successMessage = 'Copied to clipboard!',
    errorMessage = 'Failed to copy to clipboard',
	logToConsole = false
}: CopyButtonProps) {
    const getSizeClass = (size?: 'xs' | 'sm' | 'md' | 'lg'): string => {
        if (!size) return '';
        switch (size) {
            case 'xs': return 'btn-xs'; // Note: Bootstrap 5 doesn't have btn-xs, but some projects add it
            case 'sm': return 'btn-sm';
            case 'md': return ''; // md is default Bootstrap size
            case 'lg': return 'btn-lg';
            default: return '';
        }
    };

    const sizeClass = getSizeClass(size);
    const finalClassName = size 
        ? className.replace(/\b(btn-(xs|sm|md|lg))\b/g, '').trim() + (sizeClass ? ' ' + sizeClass : '')
        : className;
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
		if (logToConsole) {
			console.log('Copied to clipboard:', content);
		}
    };
    const getIconSize = (size?: 'xs' | 'sm' | 'md' | 'lg'): number => {
        switch (size) {
            case 'xs': return 12;
            case 'sm': return 14;
            case 'md': return 16;
            case 'lg': return 18;
            default: return 16;
        }
    };

    return <button className={finalClassName}
        onClick={doCopy} title='Copy to clipboard'><Copy size={getIconSize(size)} /></button>;
}