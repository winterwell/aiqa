import React from 'react';

interface ThreePanelPageProps {
	children: React.ReactNode[];
}

const ThreePanelPage: React.FC<ThreePanelPageProps> = ({children}) => {
	const [leftPanel, middlePanel, rightPanel] = children;
	return (
		<div className="container-fluid h-100 pannelled-page">
			<div className="row h-100">
				<div className="col-md-2 h-100 left-panel">
					{leftPanel}
				</div>
				<div className="col-md-5 h-100 main-panel" style={{borderLeft: "1px solid #ccc", borderRight: "1px solid #ccc"}}>
					{middlePanel}
				</div>
				{rightPanel && <div className="col-md-5 h-100 right-panel">
					{rightPanel}
				</div>}
			</div>
		</div>
	);
};

export default ThreePanelPage;