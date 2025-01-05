import ReactComponentCreator from '../../services/ai/agents/reactComponentCreator.js';

export async function generateComponentCode(req, res) {
    const { command, description, outputExample, aiGuidance } = req.body;

    if (!outputExample || !command) {
        return res.status(400).json({ error: 'Command, description and output example are required' });
    }

    try {
        const data = {
            command,
            description,
            outputExample,
            aiGuidance,
        };
        const generatedCode = await ReactComponentCreator.generateComponent(data);
        res.json({ generatedCode });
    } catch (error) {
        logger.error('AI code generation failed:', error);
        res.status(500).json({ error: 'Failed to generate component code' });
    }
}