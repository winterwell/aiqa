import React from 'react';

interface ThreePanelPageProps {
	children: React.ReactNode[];
}

const ThreePanelPage: React.FC<ThreePanelPageProps> = ({children}) => {
	const [leftPanel, middlePanel, rightPanel] = children;
	return (
		<div className="container-fluid h-100">
			<div className="row h-100">
				<div className="col-md-2 h-100">
					{leftPanel}
				</div>
				<div className="col-md-5 h-100" style={{borderLeft: "1px solid #ccc", borderRight: "1px solid #ccc"}}>
					{middlePanel}
				</div>
				{rightPanel && <div className="col-md-5 h-100">
					{rightPanel}
				</div>}
			</div>
		</div>
	);
};

export default ThreePanelPage;