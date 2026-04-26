import { useState } from "react"
import "./mensaje.css"

type Estado = "idle" | "success" | "error"

function Mensaje() {
    const [estado, setEstado] = useState<Estado>("idle")
    const [mensaje, setMensaje] = useState("")

    const generarMensaje = () => {
        const prob = Math.random()

        if (prob > 0.5) {
        setEstado("success")
        setMensaje("Operación realizada con éxito")
        } else {
        setEstado("error")
        setMensaje("Ocurrió un error en la operación")
        }
    }

    const cerrar = () => {
        setEstado("idle")
        setMensaje("")
    }

    return (
        <>
        <button className="primary-btn" onClick={generarMensaje}>
            Probar mensaje
        </button>

        {estado !== "idle" && (
            <div className="msg-overlay">
            <div className={`msg-box msg-${estado}`}>
                <h3 className="msg-title">
                {estado === "success" ? "Éxito" : "Error"}
                </h3>

                <p className="msg-text">{mensaje}</p>

                <button className="msg-btn" onClick={cerrar}>
                Cerrar
                </button>
            </div>
            </div>
        )}
        </>
    )
}

export default Mensaje