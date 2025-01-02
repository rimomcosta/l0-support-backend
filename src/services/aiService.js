// src/services/aiService.js

import { OpenAIAdapter } from '../adapters/openAiAdapter.js';
import { AnthropicAdapter } from '../adapters/anthropicAdapter.js';
import { logger } from './logger.js';

class AiService {
  constructor(provider = 'openai') {
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
Output Example: ${outputExample}
Type of Component: ${aiGuidance}

The component should be able to display the data in a dashboard in the most explanatory and graphic way, but it should look clean, futuristic, very appealing visually, and with elements that make sense. Avoid using cards unless it is the best option for the data representation. Feel free to use colors to represent intensity or importance of the data, bars, charts, etc.

CRITICAL REQUIREMENTS (must follow exactly):
1. The component MUST accept and use a 'data' prop, which will be an object representing the output of the command for a single node.
2. The 'data' object will have a 'nodeId' property (string) and an 'output' property (string or object).
3. The component should render the data for a single node. Use the 'nodeId' to differentiate the data from each node if needed.
4. DO NOT include any hardcoded data, always use the 'data' prop.
5. DO NOT use markdown code block markers.
6. Use React.createElement() instead of JSX.
7. DO NOT include import statements or ReactDOM.render. You can use React.createElement without importing React.
8. Use ONLY Tailwind classes for styling, NO inline styles.
9. Component name should reflect the command purpose (like "MyCommandComponent").
10. MUST include dark mode support using Tailwind's dark: variant.
11. When rendering a list of elements using React.createElement, you MUST provide a unique "key" prop to each top-level element in the list.
12. Don't create any grid.
13. For titles like "Node x", use a very discreet font size and color (e.g., 'text-xs text-gray-400 dark:text-gray-500').

14. **Styling and Theming:**
    - The component should have a visually appealing and clean design, suitable for a futuristic dashboard.
    - Use a white background in light mode (\`bg-white\`) and a dark gray background in dark mode (\`dark:bg-gray-800\`).
    - Apply rounded corners with \`rounded-lg\`.
    - Include a subtle border: \`border\` in light mode and \`dark:border-gray-700\` in dark mode.
    - Add a hover effect with a box shadow: \`hover:shadow-md\`.
    - Ensure smooth transitions for the shadow effect: \`transition-shadow duration-200\`.
    - Use appropriate padding within the component (e.g., \`p-4\` or \`p-6\`).
    - For text, use \`text-gray-900 dark:text-gray-100\` for primary text and \`text-gray-500 dark:text-gray-400\` for secondary text.
    - Use different font sizes (e.g., \`text-sm\`, \`text-xs\`, \`text-lg\`) and weights (e.g., \`font-medium\`, \`font-semibold\`, \`font-bold\`) as appropriate.
    - For code snippets, use a monospace font with \`font-mono\`.

15. **Error Handling:**
    - Use a \`try...catch\` block to handle potential errors when parsing the \`data.output\`.
    - If \`data\` or \`data.output\` is not available or if an error occurs during parsing, render a user-friendly error message within a \`div\` with the classes: \`text-gray-500 dark:text-gray-400 p-4\`, plus the border classes.

16. **Data Parsing:**
    - Be aware that \`data.output\` might be a JSON string, a string formatted as key-value pairs, or plain text.
    - Implement a \`parseOutput\` function (or similar logic) to handle these different formats.
    - Prioritize parsing as JSON, then as key-value pairs, and finally treat it as plain text if parsing fails.

17. **Component Structure:**
    - The component should directly render the content within its main container. Avoid unnecessary nested \`div\` elements.
    - If the component needs to render a list of items, ensure each top-level element in the list has a unique \`key\` prop.
    - For titles like "Node x", use a very discreet font size and color (e.g., \`text-xs text-gray-400 dark:text-gray-500\`).

18. **Example Structure** (for reference, do NOT use markdown fences in final output):

\`\`\`javascript
const ExampleComponent = ({ data }) => {
  const parseOutput = (output) => {
    // ... (Implementation for parsing JSON, key-value pairs, or returning raw string)
  };

  try {
    if (!data || !data.output) {
      return React.createElement('div', {
        className: 'text-gray-500 dark:text-gray-400 p-4 border border-gray-200 dark:border-gray-700 rounded-lg'
      }, 'No data available');
    }

    const parsedData = parseOutput(data.output);

    if (typeof parsedData === 'string') {
      // If parsing failed, display the raw output
      return React.createElement('div', {
        className: 'p-4 bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 hover:shadow-md transition-shadow duration-200'
      }, [
        React.createElement('div', {
          key: 'node-id',
          className: 'text-xs text-gray-400 dark:text-gray-500 mb-2'
        }, \`Node \${data.nodeId}\`),
        React.createElement('pre', {
          key: 'output',
          className: 'text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap font-mono'
        }, parsedData)
      ]);
    }

    // If parsing was successful, create the visualization based on parsedData
    // ... rest of the component logic, directly creating elements within the main container ...
    // Example:
    return React.createElement('div', {
      className: 'p-4 bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 hover:shadow-md transition-shadow duration-200'
    }, [
      React.createElement('div', {
        key: 'node-id',
        className: 'text-xs text-gray-400 dark:text-gray-500 mb-2'
      }, \`Node \${data.nodeId}\`),
      // ... other elements based on parsedData
    ]);
  } catch (error) {
    return React.createElement('div', {
      className: 'text-gray-500 dark:text-gray-400 p-4 border border-gray-200 dark:border-gray-700 rounded-lg'
    }, 'Error processing data');
  }
};
\`\`\`

Generate ONLY the component code without any markdown code block markers or extra text. Return the clean code, using React.createElement() and Tailwind classes. Respect the dark/light theme. Don't forget: Type of Component: ${aiGuidance} for the output ${outputExample}, find a way to parse it, and comply with all requirements above.
    `;
  }
}

export const aiService = new AiService();
