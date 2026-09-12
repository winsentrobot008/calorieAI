/**
 * admin-auth-bypass —— 测试期临时开关（临时状态，正式上线前必须还原为 false）
 *
 * true 时的行为：
 *   1. 后端 /api/v1/admin/* 路由守卫（getAdminAuth）直接放行，不再校验
 *      ADMIN_API_TOKEN / 后台会话令牌，也不再返回 401；
 *   2. 前端 /admin 控制台不再弹出管理员密钥输入对话框（401 拦截不会清空
 *      令牌、不会广播事件、不会渲染弹窗），后台数据请求立即执行。
 *
 * 还原方式：把 ADMIN_AUTH_BYPASS 改回 false，即可完整恢复原有鉴权链路。
 */
export const ADMIN_AUTH_BYPASS = false;
