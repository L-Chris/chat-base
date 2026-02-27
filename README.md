# chat-base

`chat-base` 是一个 Deno/TypeScript 的通用聊天网关基础库，提供：

- OpenAI 兼容类型与流式输出骨架
- Provider 适配器契约（便于不同上游接入）
- Hono HTTP 路由适配层（`/v1/chat/completions` 与 `/v1/models`）
- 上传抽象（默认实现 + URL 输入转换）

当前版本：`1.0.0`

## 安装与导入

```ts
import {
	AdapterChatService,
	createOpenAICompatibleApp,
	type ProviderAdapter,
	type OpenAI
} from '@rethinkos/chat-base'
```

## 设计分层

1. 核心层：`BaseChatService`、`buildChatConfig`、`utils`
2. Provider 契约层：`provider-contracts.ts`
3. HTTP 适配层：`http-adapter.ts`
4. 上传层：`upload.ts`

## 最小 Provider Adapter 示例

```ts
import {
	AdapterChatService,
	createOpenAICompatibleApp,
	type ProviderAdapter,
	type OpenAI
} from '@rethinkos/chat-base'

const provider: ProviderAdapter = {
	name: 'demo',
	getModels: () => [{ id: 'demo-model', name: 'demo-model', description: 'demo' }],
	getModelFeatures: () => ({ thinking: false, searching: false }),
	buildUpstreamRequest: async ({ credentials, messages, config }) => ({
		url: 'https://example.com/chat',
		init: {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${credentials.token}`
			},
			body: JSON.stringify({
				model: config.model_name,
				messages,
				stream: true
			})
		}
	}),
	parseEvent: (event): OpenAI.SendParams | null => {
		if (!event.data || event.data === '[DONE]') return { done: true }
		const payload = JSON.parse(event.data)
		if (payload.error) return { error: payload.error.message || 'upstream error' }
		const text = payload?.choices?.[0]?.delta?.content || ''
		return text ? { content: text } : null
	}
}

const app = createOpenAICompatibleApp({
	createService: () => new AdapterChatService(provider),
	getModels: provider.getModels
})

export default app
```

## 上传抽象

```ts
import { DefaultUploader, fetchUploadInputFromUrl } from '@rethinkos/chat-base'

const uploader = new DefaultUploader()
const input = await fetchUploadInputFromUrl('https://example.com/a.png', 'a.png')
const uploaded = await uploader.upload(input, { credentials: { token: 'x' } })
```

## 兼容与稳定性

- `stream` 默认值为 `true`
- `response_format.type` 支持：`text`、`json_schema`、`json_object`
- `chat-utils.getChatConfig` 保留为兼容入口，但内部已委托 `buildChatConfig`

`1.x` 主版本保证导出 API 稳定；新增能力仅做向后兼容扩展。

## 开发命令

```bash
deno task check
deno task test
```

