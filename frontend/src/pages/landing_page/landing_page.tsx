import "./landing_page.css";
import { useState } from "react";

function LandingPage() {
    const [estado, setEstado] = useState<"idle" | "loading" | "success" | "error">("idle"); //CAMBIAR CON ESTADOS DEL BACKEND
    const [mensaje, setMensaje] = useState("");

    const handleIniciar = () => {
        console.log("click en iniciar");
        setEstado("loading");
        setMensaje("Procesando archivo...");

        // MOCK de backend
        setTimeout(() => {
        const exito = Math.random() > 0.5;

        if (exito) {
            setEstado("success");
            setMensaje("Archivo procesado correctamente");
        } else {
            setEstado("error");
            setMensaje("Error al procesar el archivo");
        }
        }, 2000);
    };
    const cerrarPopup = () => {
    setEstado("idle");
    setMensaje("");
    };
    return (
        <>
        <main className="container">
        <section className="welcome">
            <span className="badge">Bienvenida</span>

            <h1 className="title">
            ¡Hola! ¿Listo para iniciar tu colección?
            </h1>

            <p className="subtitle">
            Crea tu primera colección y empieza a reunir todo lo importante en un solo lugar.
            </p>

            <button className="primary-btn" onClick={handleIniciar}>
            Iniciar
            </button>
        </section>

        <section className="collections">
            <h2 className="collections-title">Colecciones anteriores</h2>

            <div className="grid">
            <div className="card">
                <h3>Colección 1</h3>
                <p>12 archivos</p>
            </div>

            <div className="card">
                <h3>Colección 2</h3>
                <p>8 archivos</p>
            </div>

            <div className="card">
                <h3>Colección 3</h3>
                <p>21 archivos</p>
            </div>
            </div>
            </section>
        </main>
        {estado !== "idle" && (
        <div className="popup-overlay">
            <div className={`popup-box popup-${estado}`}>
            <h3 className="popup-title">
                {estado === "loading" && "Procesando"}
                {estado === "success" && "Éxito"}
                {estado === "error" && "Error"}
            </h3>

            <p className="popup-message">{mensaje}</p>

            {estado === "loading" ? (
                <div className="spinner"></div>
            ) : (
                <button className="popup-button" onClick={cerrarPopup}>
                Cerrar
                </button>
            )}
            </div>
        </div>
        )}
    </>
    );
}

export default LandingPage;