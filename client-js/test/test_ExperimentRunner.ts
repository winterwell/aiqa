import { ExperimentRunner } from '../src/ExperimentRunner';

function myEngine(input) {
	// imitate an OpenAI api responses response
	return {
		choices: [
			{
				message: {
					content: 'hello ' + input,
				},
			},
		],
	}
}

async function test_ExperimentRunner_stepwise() {
	const datasetId = '123';
	const experimentId = 'exp-123';
	const options = {datasetId, experimentId};
    const experimentRunner = new ExperimentRunner(options);
    const exampleInputs = await experimentRunner.getExampleInputs();

	for (const eg of exampleInputs) {
		const input = eg.inputs;
		const result = myEngine(input);
		let scores = await experimentRunner.scoreAndStore(eg, result);
	}
	const summaryResults = await experimentRunner.getSummaryResults();
	console.log(summaryResults);
	for (const result of summaryResults) {
		console.log(result);
	}
}

async function test_ExperimentRunner_batch() {
	const datasetId = '123';
	const experimentId = 'exp-123';
	const options = {datasetId, experimentId};
    const experimentRunner = new ExperimentRunner(options);
    await experimentRunner.run(myEngine);
	const summaryResults = await experimentRunner.getSummaryResults();
	console.log(summaryResults);
	for (const result of summaryResults) {
		console.log(result);
	}
}

