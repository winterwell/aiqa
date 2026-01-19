import { API_BASE_URL } from "../api";
import { ApiKey } from "../common/types";

export default function HowToSetYourEnv() {
	return (<div>
		<p>In environment variables (e.g. .env or otherwise), set the API key. If you're using your own server, you'll also want to set the server URL:</p>
		<p><code>AIQA_API_KEY=your-api-key<br />
			AIQA_SERVER_URL={API_BASE_URL}</code></p>
	</div>);
}