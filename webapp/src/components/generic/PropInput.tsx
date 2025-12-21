'use client';

import { Label, Input } from "reactstrap"
import React, { useCallback, useState, useEffect } from "react";

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
}

export default function PropInput({ label, item, prop, type, help, className, onChange, placeholder, multiple, list, readOnly, required, ...rest }
	: PropInputProps) 
{
	// console.log("PropInput render", { prop, type, item });
	
	if (!item) {
		// console.log("PropInput: item is null/undefined");
		item = {};
	}
		
	const initialValue = item[prop] || "";	
	const [localValue, setLocalValue] = useState(initialValue);
	
	useEffect(() => {
		// console.log("PropInput useEffect", { prop, value: item[prop] });
		const newValue = item[prop] || "";
		if (newValue !== localValue) {
			setLocalValue(newValue);
		}
	}, [prop, item, item[prop], localValue]);

	if (!label) label = prettyString(prop);
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
	return (<div className={className}>
		<Label>{label} {required && <span>*</span>} {help && <HelpText label={prop}>{help}</HelpText>}</Label>		
		<_Input value={displayValue} onChange={_onChange} type={type} {...rest} placeholder={placeholder} 
			multiple={multiple} list={list} 
			checked={type==="checkbox" ? localValue : undefined}
			readOnly={readOnly}
		/>
		{/* <code>value: {JSON.stringify(value)}</code> */}
	</div>);
}

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