'use client';

import { Label, Input } from "reactstrap"
import React, { useRef, useState, useEffect } from "react";

import HelpText from "./HelpText";

function prettyString(str: string) {
	return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, " ");
}

type InputType = "text" | "textarea" | "select" | "checkbox" | "radio" | "number" | "date" | "list";

type PropInputProps = {
	label?: string,
	item: Record<string, any>,
	prop: string,
	type?: InputType,
	options?: string[],
	help?: string,
	placeholder?: string,
	className?: string,
	/** optional Called after the item.value is set */
	onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void,
	rows?: number,
	multiple?: boolean,
	/** for select multiple, treat value as string[] */
	list?: boolean,
	readOnly?: boolean,
	/** Only affects display */
	required?: boolean,
	/** if true. display the label and input inline so e.g. it can be used in a heading */
	inline?: boolean,
	/** Fires after internal blur handling (commit local value to `item`, clear focus guard). Use to flush debounced saves. */
	onBlur?: React.FocusEventHandler<HTMLInputElement>,
}

export default function PropInput({ label, item, prop, type, help, className, onChange, placeholder, multiple, list, readOnly, required, inline, onBlur: onBlurProp, ...rest }
	: PropInputProps) 
{
	// console.log("PropInput render", { prop, type, item });
	
	if (!item) {
		// console.log("PropInput: item is null/undefined");
		item = {};
	}
		
	const initialValue = item[prop] || "";	
	const [localValue, setLocalValue] = useState(initialValue);
	const focusedRef = useRef(false);
	const localValueRef = useRef(localValue);
	localValueRef.current = localValue;

	useEffect(() => {
		if (focusedRef.current) return;
		const newValue = item[prop] || "";
		setLocalValue((prev) => {
			if (newValue === prev) return prev;
			return newValue;
		});
	}, [prop, item, item[prop]]);

	/** Re-apply local edit to `item` when the parent replaces the object (e.g. react-query refetch) while we keep showing local text. */
	const commitLocalToItem = () => {
		let v: string | string[] | boolean = localValueRef.current as string | string[] | boolean;
		if (type === "list" && typeof v === "string") {
			v = v.split(",").map((s) => s.trim());
		}
		item[prop] = v;
	};

	const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
		focusedRef.current = false;
		if (!readOnly && (type === undefined || type === "text" || type === "textarea" || type === "number" || type === "date" || type === "list")) {
			commitLocalToItem();
		}
		onBlurProp?.(e);
	};
    // label="" means no label
	if (label===null || label===undefined) label = prettyString(prop);
	const handleFocus = () => {
		focusedRef.current = true;
	};

	const _onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		let newValue: string | string[] | boolean = e.target.value;
		
		if (type === "checkbox") {
			newValue = e.target.checked;
		}
		if (type==="select" && multiple && list) { // HACK: select multiple => string[]
			// toggle
			const oldList = item[prop] || [];
			let newList;
			if (oldList.includes(newValue)) {
				newList = oldList.filter(v => v !== newValue && v !== "");
			} else if (newValue !== "") {
				newList = [...oldList, newValue];
			}
			newValue = newList;
		}
		// update local value before updating item or doing a list conversion
		setLocalValue(newValue);
		if (type === "list") { // HACK: string => list
			newValue = (newValue as string).split(",").map(v => v.trim());
		}
		// update item!
		item[prop] = newValue;		
		if (onChange) onChange(e);
	};

	// Format date value for display
	let displayValue = localValue;
	if (type === "date" && localValue) {
		displayValue = new Date(localValue).toISOString().split('T')[0];
	} else if (type === "list" && Array.isArray(localValue)) {
		displayValue = localValue?.join(", ") || "";
	}
	// rows for textarea
	if (type === "textarea" && rest.rows === undefined) {
		// estimate rows based on text length
		const text = localValue as string;
		const lines = text.split("\n");
		let rows = lines.length;
		for (const line of lines) {
			if (line.length > 120) {
				rows += Math.floor(line.length / 120);
			}
		}
		rest.rows = Math.max(3, rows);
	}

	let _Input;
	if (type === "select") {
		_Input = InputSelect;
	} else {
		_Input = Input;
	}
	// HACK: detect class h1 and apply h1-like font style. Crude but simple and it works :)
	const isH1TextInput = (type === undefined || type === "text") && !!className?.split(/\s+/).includes("h1");
	const containerStyle = inline ? { display: 'flex', alignItems: 'center', gap: '0.5rem' } : undefined;
	const labelStyle = inline ? { marginBottom: 0, marginRight: '0.5rem' } : undefined;
	const $label = <Label style={labelStyle}>{label} {required && <span>*</span>} {help && <HelpText label={prop}>{help}</HelpText>}</Label>;
	if (type === "checkbox") {
		return (<div className={className} style={containerStyle}>
			<_Input value={displayValue} 
			className="me-1"
			onChange={_onChange}
			onFocus={handleFocus}
			onBlur={handleBlur}
			type={type} {...rest} 
			placeholder={placeholder} 
				multiple={multiple} list={list} 
				checked={localValue}
				readOnly={readOnly}
				style={isH1TextInput ? { fontSize: '2rem', fontWeight: 500, lineHeight: 1.2, height: 'auto' } : undefined} />
			{$label}
			</div>);
	} // end: if checkbox
	return (<div className={className} style={containerStyle}>
		{$label}		
		<_Input value={displayValue} onChange={_onChange} onFocus={handleFocus} onBlur={handleBlur} type={type} {...rest} placeholder={placeholder} 
			multiple={multiple} list={list} 
			readOnly={readOnly}
			style={isH1TextInput ? { fontSize: '2rem', fontWeight: 500, lineHeight: 1.2, height: 'auto' } : undefined}
		/>
	</div>);
} // end: PropInput

// multiple isn't great - oh well
function InputSelect({ value, onChange, options, multiple, list, readOnly, ...rest }: {
	value: string | string[],
	onChange: (e: React.ChangeEvent<HTMLInputElement>) => void,
	options: string[],
	multiple: boolean,
	list: boolean,
	readOnly: boolean,
}) {
	const isSelected = (optionValue: string) => {
		const yes = value === optionValue || (Array.isArray(value) && value.includes(optionValue));
		return yes;
	}
	// When multiple is true, value must be an array
	let selectValue = value || "";
	if (multiple && ! Array.isArray(value)) {
		selectValue = value ? [value] : [];
	}
	return <Input type="select" value={selectValue} onChange={onChange} {...rest} readOnly={readOnly} multiple={multiple} >
		{multiple? <option value="">{""+value || "Select options"}</option>
			: <option value="">Select an option</option>}
		{options?.map(optionValue => 
			<option key={optionValue} value={optionValue} 
				style={{backgroundColor: isSelected(optionValue) ? "lightblue" : "transparent"}} >{optionValue}</option>)}
	</Input>;
}
