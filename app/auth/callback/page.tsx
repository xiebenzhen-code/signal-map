import Link from "next/link";

export default function AuthCallbackPage() {
  return <main style={{ padding: 32 }}><p>Alpha 使用预创建测试账号的邮箱和密码登录。</p><Link href="/control">返回登录</Link></main>;
}
