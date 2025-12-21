
import { Info } from "@phosphor-icons/react";
import { Popover, PopoverBody, PopoverHeader } from "reactstrap";

export default function HelpText({ label, children }: { label: string, children: string }) {
	const key = ("help-text-" + (label || children).trim()).replace(/[^a-zA-Z0-9]/g, "-");
	return <>
		<span title={children} id={key}><Info size={16} /></span>
		<Popover
			flip
			target={key}
			toggle={function noRefCheck() { }}
		>
			{label && <PopoverHeader>
				{label}
			</PopoverHeader>}
			<PopoverBody>
				{children}
			</PopoverBody>
		</Popover></>
}
