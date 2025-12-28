// import React, { useEffect, useState } from "react";
// import AceEditor from "react-ace";
// import "ace-builds/src-noconflict/mode-json";
// import "ace-builds/src-noconflict/theme-monokai";
// import "ace-builds/src-noconflict/ext-language_tools";

// interface TextEditorProps {
// 	value: string;
// 	onChange: (value: string) => void;
// 	height?: string;
// }

// const formatJson = (jsonString: string): string => {
// 	try {
// 		const parsed = JSON.parse(jsonString);
// 		return JSON.stringify(parsed, null, 2);
// 	} catch (e) {
// 		return jsonString; // Return original string if it's not valid JSON
// 	}
// };

// /**
//  * JSON editor
//  */
// export default function TextEditor({ height = "800px", value, onChange }: TextEditorProps) {
// 	const [localValue, setLocalValue] = useState<string>("");
// 	useEffect(() => {
// 		setLocalValue(formatJson(value));
// 	}, [value]);
// 	const handleChange = (newValue: string) => {
// 		setLocalValue(newValue);
// 	}
// 	const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
// 		try {
// 			const formatted = formatJson(localValue);
// 			onChange(formatted);
// 		} catch (e) {
// 			onChange(localValue); // If formatting fails, pass through the original value
// 		}
// 	};

// 	return (
// 		<div className="text-editor">
// 			<AceEditor
// 				mode="json"
// 				// theme="monokai"
// 				value={localValue}
// 				onChange={handleChange}
// 				onBlur={handleBlur}
// 				name="json-editor"
// 				editorProps={{ $blockScrolling: true }}
// 				width="100%"
// 				height={height}
// 				fontSize={16}
// 				showPrintMargin={true}
// 				showGutter={true}
// 				highlightActiveLine={true}
// 				wrapEnabled={true}
// 				setOptions={{
// 					enableBasicAutocompletion: true,
// 					enableLiveAutocompletion: true,
// 					enableSnippets: true,
// 					showLineNumbers: true,
// 					tabSize: 2,
// 				}}
// 			/>
// 		</div>
// 	);
// }