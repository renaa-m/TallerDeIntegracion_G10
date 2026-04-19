import React from "react";
import { useAuth0 } from "@auth0/auth0-react";

export const Profile: React.FC = () => {
    const { user, isAuthenticated, isLoading } = useAuth0();
    
    if (isLoading) {
        return <div>Loading...</div>;
    }

    // Usamos isAuthenticated para asegurar que user no sea undefined
    return (
        <>
            {isAuthenticated && user && (
                <div className="profile-container">
                    {/* Usamos Optional Chaining (?.) o valores por defecto para evitar errores de tipo */}
                    <img src={user.picture} alt={user.name} className="profile-picture" />
                    <h2 className="profile-name">{user.name}</h2>
                    <p className="profile-email">{user.email}</p>
                </div>
            )}
        </>
    );
};