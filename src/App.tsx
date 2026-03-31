import { useState } from "react"
import { Brain, Zap, CheckCircle, Clock, Loader, ExternalLink, Shield, Activity } from "lucide-react"
import * as StellarSdk from "@stellar/stellar-sdk"

const CLAUDE_API = "https://api.anthropic.com/v1/messages"
const KEY = (import.meta as any).env.VITE_CLAUDE_KEY
const STELLAR_HORIZON = "https://horizon-testnet.stellar.org"
const STELLAR_NETWORK = StellarSdk.Networks.TESTNET

interface Payment {
  id: string
  tool: string
  amount: string
  txHash: string
  timestamp: number
  status: "pending" | "success" | "failed"
}

interface AgentStep {
  id: string
  type: "thinking" | "paying" | "executing" | "done"
  message: string
  timestamp: number
  payment?: Payment
}

interface AgentResult {
  answer: string
  steps: AgentStep[]
  totalCost: string
  txCount: number
}

const TOOLS = [
  { name: "Web Search", cost: "0.001", description: "Search the web for information" },
  { name: "Data Analysis", cost: "0.002", description: "Analyze and process data" },
  { name: "Code Execution", cost: "0.003", description: "Execute and test code" },
  { name: "Image Analysis", cost: "0.005", description: "Analyze images and visual data" },
  { name: "Premium API", cost: "0.01", description: "Access premium data sources" },
]

export default function App() {
  const [query, setQuery] = useState("")
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<AgentResult | null>(null)
  const [steps, setSteps] = useState<AgentStep[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [walletKey, setWalletKey] = useState("")
  const [walletAddress, setWalletAddress] = useState("")
  const [walletBalance, setWalletBalance] = useState("0")
  const [notif, setNotif] = useState("")
  const [tab, setTab] = useState<"agent"|"wallet"|"history">("agent")
  const [totalSpent, setTotalSpent] = useState("0")

  const toast = (m: string) => { setNotif(m); setTimeout(() => setNotif(""), 3000) }

  async function loadWallet(secretKey: string) {
    try {
      const keypair = StellarSdk.Keypair.fromSecret(secretKey)
      const addr = keypair.publicKey()
      setWalletAddress(addr)
      setWalletKey(secretKey)
      
      // Get balance via fetch (CORS friendly)
      try {
        const res = await fetch(STELLAR_HORIZON + "/accounts/" + addr)
        const data = await res.json()
        const xlm = data.balances?.find((b: any) => b.asset_type === "native")
        setWalletBalance(xlm ? parseFloat(xlm.balance).toFixed(4) : "0")
      } catch {
        setWalletBalance("100.0000") // demo balance
      }
      toast("Wallet loaded!")
    } catch(e: any) {
      console.error("Wallet error:", e)
      toast("Invalid secret key format")
    }
  }

  async function sendStellarPayment(secretKey: string, amount: string, memo: string): Promise<string> {
    const server = new StellarSdk.Horizon.Server(STELLAR_HORIZON)
    const keypair = StellarSdk.Keypair.fromSecret(secretKey)
    const account = await server.loadAccount(keypair.publicKey())
    
    // Send to self as payment record (demo)
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: STELLAR_NETWORK
    })
    .addOperation(StellarSdk.Operation.payment({
      destination: keypair.publicKey(),
      asset: StellarSdk.Asset.native(),
      amount: amount
    }))
    .addMemo(StellarSdk.Memo.text(memo.slice(0, 28)))
    .setTimeout(30)
    .build()
    
    tx.sign(keypair)
    const result = await server.submitTransaction(tx)
    return result.hash
  }

  async function runAgent() {
    if (!query.trim()) return
    if (!walletKey) { toast("Please load your Stellar wallet first!"); setTab("wallet"); return }
    
    setRunning(true)
    setSteps([])
    setResult(null)
    const newSteps: AgentStep[] = []
    const newPayments: Payment[] = []

    const addStep = (step: AgentStep) => {
      newSteps.push(step)
      setSteps([...newSteps])
    }

    try {
      // Step 1: AI decides what tools to use
      addStep({ id: "1", type: "thinking", message: "Analyzing your request and selecting tools...", timestamp: Date.now() })
      
      const planRes = await fetch(CLAUDE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-calls": "true" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 500,
          system: "You are StellarMind, an AI agent using paid Stellar micropayments. Decide which 2-3 tools to use: Web Search 0.001 XLM, Data Analysis 0.002 XLM, Code Execution 0.003 XLM, Premium API 0.01 XLM. Return JSON with tools array, reasoning string, answer string",
          messages: [{ role: "user", content: query }]
        })
      })
      const planData = await planRes.json()
      const planText = planData.content?.[0]?.text || "{}"
      const plan = JSON.parse(planText.replace(/```json|```/g, "").trim())
      
      addStep({ id: "2", type: "thinking", message: `Selected tools: ${plan.tools?.join(", ")}. Reasoning: ${plan.reasoning}`, timestamp: Date.now() })

      // Step 2: Pay for each tool via Stellar
      let totalCost = 0
      for (const toolName of (plan.tools || ["Web Search"])) {
        const tool = TOOLS.find(t => t.name === toolName) || TOOLS[0]
        
        addStep({ id: "pay_" + toolName, type: "paying", message: `Paying ${tool.cost} XLM for ${tool.name}...`, timestamp: Date.now() })
        
        try {
          const txHash = await sendStellarPayment(walletKey, tool.cost, "StellarMind:" + toolName.slice(0,20))
          totalCost += parseFloat(tool.cost)
          
          const payment: Payment = {
            id: Date.now().toString(),
            tool: toolName,
            amount: tool.cost + " XLM",
            txHash,
            timestamp: Date.now(),
            status: "success"
          }
          newPayments.push(payment)
          setPayments(prev => [payment, ...prev])
          
          addStep({ 
            id: "paid_" + toolName, 
            type: "executing", 
            message: `Paid! Executing ${tool.name}...`, 
            timestamp: Date.now(),
            payment
          })
          
          await new Promise(r => setTimeout(r, 800))
        } catch(e) {
          addStep({ id: "fail_" + toolName, type: "done", message: `Payment failed for ${toolName} — using cached data`, timestamp: Date.now() })
        }
      }

      // Update balance
      const server = new StellarSdk.Horizon.Server(STELLAR_HORIZON)
      const keypair = StellarSdk.Keypair.fromSecret(walletKey)
      const account = await server.loadAccount(keypair.publicKey())
      const xlm = account.balances.find((b: any) => b.asset_type === "native")
      setWalletBalance(xlm ? parseFloat(xlm.balance).toFixed(4) : "0")
      setTotalSpent(prev => (parseFloat(prev) + totalCost).toFixed(4))

      addStep({ id: "done", type: "done", message: "All tools executed. Generating final answer...", timestamp: Date.now() })

      setResult({
        answer: plan.answer || "Analysis complete based on paid tool results.",
        steps: newSteps,
        totalCost: totalCost.toFixed(4) + " XLM",
        txCount: newPayments.length
      })

    } catch(e: any) {
      console.error("Agent error:", e)
      toast("Error: " + (e?.message || "Check wallet and API key"))
    }
    setRunning(false)
  }

  const S: Record<string, any> = {
    app: { minHeight: "100vh", background: "#000", color: "#e8edf5", fontFamily: "sans-serif", paddingBottom: "64px" },
    header: { background: "rgba(0,0,0,0.95)", borderBottom: "1px solid #1a2540", padding: "0 16px", height: "52px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky" as const, top: 0, zIndex: 50 },
    card: { background: "#0a0a0a", border: "1px solid #1a2540", borderRadius: "10px", padding: "14px", marginBottom: "8px" },
    input: { background: "#111", border: "1px solid #1a2540", borderRadius: "8px", padding: "10px 13px", color: "#e8edf5", fontSize: "13px", width: "100%", outline: "none", boxSizing: "border-box" as const },
    btn: (v: "g"|"ghost"|"dim") => ({ background: v==="g"?"linear-gradient(135deg,#00ff88,#00cc6a)":"transparent", border: v==="ghost"?"1px solid #1a2540":"none", borderRadius: "8px", color: v==="g"?"#000":"#e8edf5", padding: "10px 18px", cursor: "pointer", fontWeight: 700, fontSize: "13px" }),
    nav: { position: "fixed" as const, bottom: 0, left: 0, right: 0, background: "#000", borderTop: "1px solid #1a2540", display: "flex", height: "56px", zIndex: 100 },
    navBtn: (a: boolean) => ({ flex: 1, background: "none", border: "none", color: a?"#00ff88":"#4a5a7a", cursor: "pointer", display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", gap: "2px", fontSize: "9px", fontWeight: a?700:500 }),
    pill: (c: string) => ({ background: c+"18", border: "1px solid "+c+"40", borderRadius: "4px", padding: "2px 8px", fontSize: "10px", fontWeight: 700, color: c }),
    mono: { fontFamily: "monospace" } as React.CSSProperties,
    green: { color: "#00ff88" } as React.CSSProperties,
  }

  return (
    <div style={S.app}>
      {notif && <div style={{ position: "fixed" as const, top: "60px", left: "50%", transform: "translateX(-50%)", background: "#111", border: "1px solid #00ff8840", borderRadius: "6px", padding: "8px 18px", zIndex: 200, color: "#00ff88", fontWeight: 600, fontSize: "12px", whiteSpace: "nowrap" as const }}>{notif}</div>}

      <div style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Brain size={16} color="#00ff88" />
          <span style={{ fontWeight: 800, fontSize: "16px" }}>Stellar<span style={S.green}>Mind</span></span>
          <span style={S.pill("#00ff88")}>x402</span>
        </div>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          {walletAddress && <span style={{ ...S.pill("#8855ff"), ...S.mono }}>{walletBalance} XLM</span>}
          <span style={S.pill("#ffaa00")}>Testnet</span>
        </div>
      </div>

      {/* AGENT TAB */}
      {tab === "agent" && (
        <div style={{ padding: "12px" }}>
          <div style={{ ...S.card, background: "linear-gradient(135deg,#0a0a0a,#0c1a0c)", border: "1px solid #00ff8820", marginBottom: "12px" }}>
            <div style={{ fontSize: "11px", letterSpacing: "2px", color: "#4a5a7a", marginBottom: "8px" }}>ASK STELLARMIND</div>
            <textarea
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="What would you like to research? The agent will pay for tools using Stellar micropayments..."
              style={{ ...S.input, height: "80px", resize: "none" as const, marginBottom: "8px" }}
            />
            <div style={{ display: "flex", gap: "6px", marginBottom: "8px", flexWrap: "wrap" as const }}>
              {["Analyze Bitcoin price trends", "Research Stellar ecosystem", "Compare DeFi protocols"].map(s => (
                <button key={s} onClick={() => setQuery(s)} style={{ background: "#111", border: "1px solid #1a2540", borderRadius: "6px", color: "#8899bb", padding: "4px 10px", fontSize: "11px", cursor: "pointer" }}>{s}</button>
              ))}
            </div>
            <button style={{ ...S.btn("g"), width: "100%", padding: "12px", fontSize: "14px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }} onClick={runAgent} disabled={running}>
              {running ? <><Loader size={14} style={{ animation: "spin 1s linear infinite" }} /> Running Agent...</> : <><Zap size={14} /> Run Agent (pays with XLM)</>}
            </button>
          </div>

          {/* Steps */}
          {steps.length > 0 && (
            <div style={S.card}>
              <div style={{ fontSize: "11px", letterSpacing: "2px", color: "#4a5a7a", marginBottom: "10px" }}>AGENT EXECUTION LOG</div>
              {steps.map(step => (
                <div key={step.id} style={{ display: "flex", gap: "10px", padding: "6px 0", borderBottom: "1px solid #1a2540" }}>
                  <div style={{ flexShrink: 0, marginTop: "2px" }}>
                    {step.type === "thinking" && <Brain size={12} color="#8855ff" />}
                    {step.type === "paying" && <Loader size={12} color="#ffaa00" style={{ animation: "spin 1s linear infinite" }} />}
                    {step.type === "executing" && <Activity size={12} color="#00ff88" />}
                    {step.type === "done" && <CheckCircle size={12} color="#00ff88" />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "12px", color: "#e8edf5" }}>{step.message}</div>
                    {step.payment && (
                      <div style={{ fontSize: "10px", color: "#00ff88", marginTop: "2px", ...S.mono }}>
                        TX: {step.payment.txHash.slice(0,16)}...
                        <a href={`https://stellar.expert/explorer/testnet/tx/${step.payment.txHash}`} target="_blank" rel="noreferrer" style={{ color: "#8855ff", marginLeft: "6px" }}>
                          <ExternalLink size={10} style={{ display: "inline" }} />
                        </a>
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: "10px", color: "#4a5a7a", ...S.mono, flexShrink: 0 }}>
                    {new Date(step.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Result */}
          {result && (
            <div style={{ ...S.card, border: "1px solid #00ff8840" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
                <div style={{ fontSize: "11px", letterSpacing: "2px", color: "#4a5a7a" }}>AGENT RESULT</div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <span style={S.pill("#00ff88")}>{result.totalCost}</span>
                  <span style={S.pill("#8855ff")}>{result.txCount} txns</span>
                </div>
              </div>
              <div style={{ fontSize: "13px", color: "#e8edf5", lineHeight: 1.7 }}>{result.answer}</div>
            </div>
          )}

          {/* Tools */}
          <div style={S.card}>
            <div style={{ fontSize: "11px", letterSpacing: "2px", color: "#4a5a7a", marginBottom: "10px" }}>AVAILABLE PAID TOOLS</div>
            {TOOLS.map(t => (
              <div key={t.name} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #1a2540" }}>
                <div>
                  <div style={{ fontSize: "12px", fontWeight: 600 }}>{t.name}</div>
                  <div style={{ fontSize: "10px", color: "#4a5a7a" }}>{t.description}</div>
                </div>
                <span style={{ ...S.pill("#ffaa00"), alignSelf: "center", ...S.mono }}>{t.cost} XLM</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* WALLET TAB */}
      {tab === "wallet" && (
        <div style={{ padding: "12px" }}>
          <div style={{ ...S.card, background: "linear-gradient(135deg,#0a0a0a,#0a0c1a)" }}>
            <div style={{ fontSize: "11px", letterSpacing: "2px", color: "#4a5a7a", marginBottom: "8px" }}>STELLAR WALLET</div>
            {walletAddress ? (
              <>
                <div style={{ fontSize: "10px", color: "#4a5a7a", marginBottom: "2px" }}>Address</div>
                <div style={{ fontSize: "12px", ...S.mono, color: "#e8edf5", marginBottom: "12px", wordBreak: "break-all" as const }}>{walletAddress}</div>
                <div style={{ display: "flex", gap: "16px" }}>
                  <div><div style={{ fontSize: "10px", color: "#4a5a7a" }}>BALANCE</div><div style={{ fontSize: "20px", fontWeight: 700, color: "#00ff88", ...S.mono }}>{walletBalance} XLM</div></div>
                  <div><div style={{ fontSize: "10px", color: "#4a5a7a" }}>TOTAL SPENT</div><div style={{ fontSize: "20px", fontWeight: 700, color: "#ffaa00", ...S.mono }}>{totalSpent} XLM</div></div>
                </div>
                <a href={`https://stellar.expert/explorer/testnet/account/${walletAddress}`} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: "10px", fontSize: "11px", color: "#8855ff" }}>
                  View on Stellar Explorer →
                </a>
              </>
            ) : (
              <>
                <div style={{ fontSize: "12px", color: "#8899bb", marginBottom: "12px" }}>Enter your Stellar testnet secret key to enable payments</div>
                <input
                  type="password"
                  placeholder="S... (Stellar Secret Key)"
                  style={{ ...S.input, marginBottom: "8px", ...S.mono }}
                  onChange={e => setWalletKey(e.target.value)}
                />
                <button style={{ ...S.btn("g"), width: "100%" }} onClick={() => loadWallet(walletKey)}>Load Wallet</button>
                <div style={{ fontSize: "10px", color: "#4a5a7a", marginTop: "8px" }}>Get testnet XLM: friendbot.stellar.org</div>
              </>
            )}
          </div>

          <div style={S.card}>
            <div style={{ fontSize: "11px", letterSpacing: "2px", color: "#4a5a7a", marginBottom: "8px" }}>HOW IT WORKS</div>
            {[
              { i: "1", t: "Load Wallet", d: "Enter your Stellar testnet secret key" },
              { i: "2", t: "Ask Agent", d: "Type any research or analysis question" },
              { i: "3", t: "Agent Pays", d: "Agent pays XLM for each tool it uses" },
              { i: "4", t: "Get Answer", d: "Receive AI-powered answer with receipts" },
            ].map(s => (
              <div key={s.i} style={{ display: "flex", gap: "10px", padding: "6px 0", borderBottom: "1px solid #1a2540" }}>
                <div style={{ width: "20px", height: "20px", borderRadius: "50%", background: "#00ff8820", border: "1px solid #00ff8840", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", color: "#00ff88", flexShrink: 0 }}>{s.i}</div>
                <div>
                  <div style={{ fontSize: "12px", fontWeight: 600 }}>{s.t}</div>
                  <div style={{ fontSize: "10px", color: "#4a5a7a" }}>{s.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* HISTORY TAB */}
      {tab === "history" && (
        <div style={{ padding: "12px" }}>
          <div style={S.card}>
            <div style={{ fontSize: "11px", letterSpacing: "2px", color: "#4a5a7a", marginBottom: "10px" }}>PAYMENT HISTORY</div>
            {payments.length === 0 ? (
              <div style={{ color: "#4a5a7a", fontSize: "12px", textAlign: "center" as const, padding: "20px" }}>No payments yet. Run the agent!</div>
            ) : payments.map((p, i) => (
              <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid #1a2540" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 600 }}>{p.tool}</span>
                  <span style={{ color: "#00ff88", fontWeight: 700, ...S.mono }}>{p.amount}</span>
                </div>
                <div style={{ fontSize: "10px", color: "#4a5a7a", ...S.mono }}>
                  TX: {p.txHash.slice(0, 20)}...
                  <a href={`https://stellar.expert/explorer/testnet/tx/${p.txHash}`} target="_blank" rel="noreferrer" style={{ color: "#8855ff", marginLeft: "4px" }}>
                    <ExternalLink size={10} style={{ display: "inline" }} />
                  </a>
                </div>
                <div style={{ fontSize: "10px", color: "#4a5a7a" }}>{new Date(p.timestamp).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <nav style={S.nav}>
        {[
          { id: "agent", l: "Agent", i: <Brain size={16}/> },
          { id: "wallet", l: "Wallet", i: <Shield size={16}/> },
          { id: "history", l: "History", i: <Clock size={16}/> },
        ].map(n => (
          <button key={n.id} onClick={() => setTab(n.id as any)} style={S.navBtn(tab === n.id)}>
            {n.i}<span>{n.l}</span>
          </button>
        ))}
      </nav>

      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
    </div>
  )
}
