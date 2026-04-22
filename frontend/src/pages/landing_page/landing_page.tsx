import "./landing_page.css";
import { useState } from "react";
import { useParams } from "react-router-dom"; // Importar para capturar el :id_usuario
import { useAuth0 } from '@auth0/auth0-react'; // Para validar contra el usuario real

function LandingPage() {
    const { id_usuario } = useParams<{ id_usuario: string }>(); // Captura el parámetro de la URL
    const { user } = useAuth0(); // Obtenemos la info del usuario logueado
    
    const [estado, setEstado] = useState<"idle" | "loading" | "success" | "error">("idle");
    const [mensaje, setMensaje] = useState("");

    // Opcional: Validación de seguridad
    // Extraemos el ID real del token para comparar con la URL
    const currentUserId = user?.sub?.split('|')[1] || user?.nickname;

    const handleIniciar = () => {
        console.log("click en iniciar");
        setEstado("loading");
        setMensaje("Procesando archivo...");

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

    // Si alguien intenta entrar a un ID que no es el suyo, podrías bloquearlo aquí
    if (id_usuario !== currentUserId) {
        return (
            <main className="container">
                <section className="welcome">
                    <h1 className="title">Acceso denegado</h1>
                    <p className="subtitle">No tienes permiso para ver esta colección.</p>
                </section>
            </main>
        );
    }

    return (
        <>
            <main className="container">
                <section className="welcome">
                    <span className="badge">Bienvenida</span>

                    <h1 className="title">
                        ¡Hola, {user?.given_name || user?.nickname}!
                    </h1>

                    <p className="subtitle">
                        ID de Colección: <span style={{ fontWeight: 'bold', color: 'var(--accent)' }}>{id_usuario}</span>
                        <br />
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