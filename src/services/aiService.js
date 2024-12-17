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

    async generateComponentCode(command, description, outputExample, aiGuidance = '') {
        try {
            const prompt = this.createPrompt(command, description, outputExample, aiGuidance);
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


    createPrompt(command, description, outputExample, aiGuidance = '') {
        return `
        You are a React code generation assistant. Generate a React component for a dashboard based on the following information:
    
        Command: ${command}
        Description: ${description}
        Output Example:
        ${outputExample}
        Type of Component: ${aiGuidance}
    
        The component should be able to display the data in a dashboard in the most explanatory and graphic way, but it should look clean, futuristic, very appealling visualy and with elements that make sense. Avoid using cards unless it is the best option for the data representation. Feel free to use collors to represent intensity or importance of the data, bars, charts, etc.
        
        CRITICAL REQUIREMENTS (must follow exactly):
        1. The component MUST accept and use a 'data' prop, which will be an object representing the output of the command for a single node.
        2. The 'data' object will have a 'nodeId' property (string) and an 'output' property (string or object).
        3. The component should render the data for a single node. Use the 'nodeId' to differentiate the data from each node if needed.
        4. DO NOT include any hardcoded data, always use the 'data' prop.
        5. DO NOT use markdown code block markers
        6. Use React.createElement() instead of JSX
        7. DO NOT include import statements or ReactDOM.render. You can use React.createElement without importing React.
        8. Use ONLY Tailwind classes for styling, NO inline styles
        9. Component name should reflect the command purpose
        10. MUST include dark mode support using Tailwind's dark: variant
        11. When rendering a list of elements using React.createElement, you MUST provide a unique "key" prop to each top-level element in the list. The key should be a string that uniquely identifies the element among its siblings.
        12. Don't create any grid.
        13. for titles like "Node x", use very discreet font size and color.
        14. For dark mode, always use a very tin gray border when applicable.
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
    
        const SingleNodeMetric = ({ data }) => {
          if (!data) {
            return React.createElement('div', {
              className: 'text-gray-500 dark:text-gray-400 p-4'
            }, 'No data available');
          }
        
          return React.createElement('div', {
            className: 'p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 mb-4'
          }, [
            React.createElement('h3', {
              key: 'node-title',
              className: 'text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2'
            }, 'Node ' + data.nodeId),
            React.createElement('pre', {
              key: 'output',
              className: 'text-sm whitespace-pre-wrap'
            }, JSON.stringify(data.output, null, 2))
          ]);
        };
    
        Generate ONLY the component code without any markdown or decorations. Return just the clean code, be creative:`;
    }
}

export const aiService = new AiService();