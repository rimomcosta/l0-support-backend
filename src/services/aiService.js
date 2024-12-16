// src/services/aiService.js
import { OpenAIAdapter } from '../adapters/openAiAdapter.js';
import { AnthropicAdapter } from '../adapters/anthropicAdapter.js';
import { logger } from './logger.js';

class AiService {
    constructor(provider = 'anthropic') {
        this.provider = provider;
        this.adapter = this.createAdapter(provider);
    }

    createAdapter(provider) {
        switch (provider) {
            case 'openai':
                return new OpenAIAdapter();
            case 'anthropic':
                return new AnthropicAdapter();
            default:
                throw new Error(`Unsupported AI provider: ${provider}`);
        }
    }

    async generateComponentCode(command, description, outputExample) {
        try {
            const prompt = this.createPrompt(command, description, outputExample);
            const generatedCode = await this.adapter.generateCode(prompt);

            // Clean up the response if needed based on the provider
            const cleanedCode = this.cleanGeneratedCode(generatedCode);
            return cleanedCode;
        } catch (error) {
            logger.error('Failed to generate component code:', {
                error: error.message,
                provider: this.provider
            });
            throw error;
        }
    }

    cleanGeneratedCode(code) {
        // Remove any markdown code blocks or unnecessary formatting
        return code
            .replace(/```(jsx|javascript)?\n?/g, '')
            .replace(/```$/g, '')
            .trim();
    }


    createPrompt(command, description, outputExample) {
        return `
        You are a React code generation assistant. Generate a nicer React component possible for a dashboard based on the following information:
    
        Command: ${command}
        Description: ${description}
        Output Example:
        ${outputExample}
    
        The component should be able to display the data in a dashboard in the most explanatory and graphic way, but it should look clean, futuristic, very appealling visualy and with elements that make sense. Avoid using cards unless it is the best option for the data representation. Feel free to use collors to represent intensity or importance of the data.
        
        CRITICAL REQUIREMENTS (must follow exactly):
        1. The component MUST accept and use a 'data' prop, which will be an array of objects. Each object in the array represents the output of the command for a single node.
        2. Each object in the 'data' array will have a 'nodeId' property (string) and an 'output' property (string or object).
        3. The component should render the data for all nodes in a single component instance, in a horizontal layout, wrapping to a new line when necessary. Use the 'nodeId' to differentiate the data from each node.
        4. The component MUST accept a 'layout' prop (string) that will be used to set its width in a 12-column grid system (e.g., 'col-span-12', 'col-span-6', 'col-span-4', etc.). Apply this prop to the element of the component but not to the outermost container.
        5. DO NOT include any hardcoded data, always use the 'data' prop.
        6. DO NOT use markdown code block markers
        7. Use React.createElement() instead of JSX
        8. DO NOT include import statements or ReactDOM.render. You can use React.createElement without importing React.
        9. Use ONLY Tailwind classes for styling, NO inline styles
        10. Component name should reflect the command purpose
        11. MUST include dark mode support using Tailwind's dark: variant
        12. When rendering a list of elements using React.createElement, you MUST provide a unique "key" prop to each top-level element in the list. The key should be a string that uniquely identifies the element among its siblings.
        13. Don't create any grid.
        14. for titles like "Node x", use very discreet font size and color.
        15. For dark mode, always use a very tin gray border when applicable.
        Example of dark mode support with Tailwind:
        className: "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
    
        Common dark mode patterns:
        - Light backgrounds: bg-white dark:bg-gray-800
        - Dark backgrounds: bg-gray-50 dark:bg-gray-900
        - Primary text: text-gray-900 dark:text-gray-100
        - Secondary text: text-gray-500 dark:text-gray-400
        - Borders: border-gray-200 dark:border-gray-700
        - Card backgrounds: bg-white dark:bg-gray-800
        
        Example structure:
    
        const SystemMetricsComponent = ({ data, layout = 'col-span-12' }) => {
        if (!data || data.length === 0) {
            return React.createElement('div', {
            className: 'text-gray-500 dark:text-gray-400 p-4'
            }, 'No data available');
        }

        return data.map((item) => {
            return React.createElement('div', {
            key: item.nodeId,
            className: 'layout p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 mb-4'
            }, [
            React.createElement('h3', {
                key: 'node-title-' + item.nodeId,
                className: 'text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2'
            }, 'Node ' + item.nodeId),
            React.createElement('pre', {
                key: 'output-' + item.nodeId,
                className: 'text-sm whitespace-pre-wrap'
            }, JSON.stringify(item.output, null, 2))
            ]);
        });
        };
    
        Generate ONLY the component code without any markdown or decorations. Return just the clean code:`;
    }
}

export const aiService = new AiService();