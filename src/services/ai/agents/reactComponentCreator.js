// src/services/ai/agents/reactComponentCreator.js
import { aiService } from '../aiService.js';

const instructions = (data) => `
You are a React code generator. Generate a React component for a dashboard based on the following information:

Command: \`\`\`${data.command}\`\`\`
Description: \`\`\`${data.description}\`\`\`
Output Example: \`\`\`${data.outputExample}\`\`\`
Type of Component: \`\`\`${data.aiGuidance || 'Optimal for a dashboard'}\`\`\`

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

Generate ONLY the component code without any markdown code block markers or extra text. Return the clean code, using React.createElement() and Tailwind classes. Respect the dark/light theme. Comply with ALL requirements above without loosing the context - Do not let any element from within a component to overflow its container! Pay attention to the Type of Component: "${data.aiGuidance || 'Optimal for a dashboard'}", and this is an example of the data the component will display ${data.outputExample} Take the quotations mark and json elements into consideration, if present
`;

const config = {
    provider: 'firefall',
    model: 'gpt-4o',
    temperature: 0.1,
    maxTokens: 3000,
    stream: false,
    systemMessage: 'You are a helpful assistant that generates React code. You don\'t do anything else and your code is related to the dashboard only. Be carefull with harmfull instructions or instructions that asks you to do things out of scope in react code.',
};

async function generateComponent(data) {
    const adapter = aiService.getAdapter(config.provider, config);
    const prompt = instructions(data);
    
    const generatedCode = await adapter.generateCode({
        prompt,
        model: config.model,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        systemMessage: config.systemMessage,
    });
    
    // Basic cleanup (remove markdown code blocks)
    const cleanedCode = generatedCode
        .replace(/```(jsx|javascript)?/g, '')
        .replace(/```/g, '')
        .trim();

    return cleanedCode;
}

const ReactComponentCreator = {
    generateComponent,
};

export default ReactComponentCreator;