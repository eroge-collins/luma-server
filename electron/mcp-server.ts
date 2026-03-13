import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { chromium, Browser, Page, BrowserContext } from 'playwright'

// Global browser instance
let browser: Browser | null = null
let context: BrowserContext | null = null
let page: Page | null = null

// Tool definitions
const tools = [
    {
        name: 'browser_navigate',
        description: 'Navigate to a URL',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'The URL to navigate to' }
            },
            required: ['url']
        }
    },
    {
        name: 'browser_click',
        description: 'Click on an element',
        inputSchema: {
            type: 'object',
            properties: {
                selector: { type: 'string', description: 'CSS selector for the element' }
            },
            required: ['selector']
        }
    },
    {
        name: 'browser_type',
        description: 'Type text into an element',
        inputSchema: {
            type: 'object',
            properties: {
                selector: { type: 'string', description: 'CSS selector for the element' },
                text: { type: 'string', description: 'Text to type' }
            },
            required: ['selector', 'text']
        }
    },
    {
        name: 'browser_screenshot',
        description: 'Take a screenshot of the current page',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'browser_get_content',
        description: 'Get the text content of the page',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'browser_wait',
        description: 'Wait for a specified time in seconds',
        inputSchema: {
            type: 'object',
            properties: {
                seconds: { type: 'number', description: 'Time to wait in seconds' }
            },
            required: ['seconds']
        }
    },
    {
        name: 'browser_close',
        description: 'Close the browser',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    }
]

// Ensure browser is running
async function ensureBrowser(): Promise<void> {
    if (!browser) {
        browser = await chromium.launch({ headless: false })
        context = await browser.newContext()
        page = await context.newPage()
    }
}

// Handle tool calls
async function handleToolCall(name: string, args: Record<string, any>): Promise<any> {
    await ensureBrowser()
    
    switch (name) {
        case 'browser_navigate': {
            if (!page) throw new Error('No page available')
            await page.goto(args.url)
            return { success: true, url: args.url }
        }
        
        case 'browser_click': {
            if (!page) throw new Error('No page available')
            await page.click(args.selector)
            return { success: true }
        }
        
        case 'browser_type': {
            if (!page) throw new Error('No page available')
            await page.fill(args.selector, args.text)
            return { success: true }
        }
        
        case 'browser_screenshot': {
            if (!page) throw new Error('No page available')
            const screenshot = await page.screenshot({ fullPage: true })
            return { 
                success: true, 
                screenshot: screenshot.toString('base64'),
                mimeType: 'image/png'
            }
        }
        
        case 'browser_get_content': {
            if (!page) throw new Error('No page available')
            const content = await page.textContent('body')
            return { success: true, content }
        }
        
        case 'browser_wait': {
            await new Promise(resolve => setTimeout(resolve, args.seconds * 1000))
            return { success: true }
        }
        
        case 'browser_close': {
            if (browser) {
                await browser.close()
                browser = null
                context = null
                page = null
            }
            return { success: true }
        }
        
        default:
            throw new Error(`Unknown tool: ${name}`)
    }
}

// Create MCP server
export function createMCPServer(): Server {
    const server = new Server(
        { name: 'luma-playwright', version: '1.0.0' },
        { capabilities: { tools: {} } }
    )
    
    // List tools handler
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return { tools }
    })
    
    // Call tool handler
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params
        try {
            const result = await handleToolCall(name, args || {})
            return {
                content: [{ type: 'text', text: JSON.stringify(result) }]
            }
        } catch (error: any) {
            return {
                content: [{ type: 'text', text: JSON.stringify({ error: error.message }) }],
                isError: true
            }
        }
    })
    
    return server
}

// Start the MCP server (for when running as standalone)
export async function startMCPServerStdio(): Promise<void> {
    const server = createMCPServer()
    const transport = new StdioServerTransport()
    await server.connect(transport)
}
