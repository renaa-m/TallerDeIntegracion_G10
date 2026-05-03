from fastapi import APIRouter, HTTPException, status, Depends
from app.services.delete_user import purge_complete_user
# Importa aquí tu lógica de autenticación (ej. get_current_user)

router = APIRouter(prefix="/usuarios", tags=["usuarios"])

@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_my_account(
    # user_id: str = Depends(get_current_user_id) <-- Usa tu dependencia de Auth0
    user_id: str 
):
    try:
        purge_complete_user(user_id)
        return None
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error interno al procesar la eliminación de cuenta"
        )