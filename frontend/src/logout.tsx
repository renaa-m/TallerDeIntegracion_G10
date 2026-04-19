import React from "react";
import { useAuth0 } from "@auth0/auth0-react";  

export const LogoutButton: React.FC = () => {
    const { logout } = useAuth0();

    return (
        <button 
            onClick={() => 
                logout({ 
                    logoutParams: { 
                        returnTo: window.location.origin 
                    } 
                })
            }
            className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded"
        >
            Log Out
        </button>
    );
};
