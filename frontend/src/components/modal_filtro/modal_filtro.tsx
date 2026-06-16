import React from 'react'
import { X } from 'lucide-react'
// 1. CORREGIDO: Importamos asignando el objeto 'styles' explícitamente
// (Asegúrate de que el archivo se llame exactamente así en tu carpeta)
import styles from './modal_filtros.module.css'

interface EntityFacet {
  id: string
  label: string
  tipo: string
}

interface ModalFiltrosProps {
  tiposEntidad: string[]
  tipoFiltroUI: string | null
  setTipoFiltroUI: (tipo: string | null) => void
  entitySearch: string
  setEntitySearch: (search: string) => void
  entidades: EntityFacet[]
  entidadesFiltradas: EntityFacet[]
  entidadesSeleccionadas: string[]
  toggleEntidad: (label: string) => void
  logicaEntidades: 'OR' | 'AND'
  setLogicaEntidades: (logica: 'OR' | 'AND') => void
  setEntidadesSeleccionadas: (entidades: string[]) => void
}

const ModalFiltros: React.FC<ModalFiltrosProps> = ({
  tiposEntidad,
  tipoFiltroUI,
  setTipoFiltroUI,
  entitySearch,
  setEntitySearch,
  entidades,
  entidadesFiltradas,
  entidadesSeleccionadas,
  toggleEntidad,
  logicaEntidades,
  setLogicaEntidades,
  setEntidadesSeleccionadas,
}) => {
  return (
    // 2. CORREGIDO: Todos los classNames ahora usan el objeto 'styles' para CSS Modules
    <div className={styles.filterPanel}>
      {/* Selector de Pestañas por Categoría / Tipo */}
      <div className={styles.filterGroup}>
        <span className={styles.filterLabel}>Tipo de entidad</span>
        <div className={styles.filterChips}>
          <button
            type="button"
            className={`${styles.filterChip} ${tipoFiltroUI === null ? styles.selected : ''}`}
            onClick={() => setTipoFiltroUI(null)}
          >
            Todas
          </button>
          {tiposEntidad.map((tipo) => (
            <button
              key={tipo}
              type="button"
              className={`${styles.filterChip} ${tipoFiltroUI === tipo ? styles.selected : ''}`}
              onClick={() => setTipoFiltroUI(tipo)}
            >
              {tipo}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.filterDivider} />

      {/* Buscador de texto + Caja Scrollable de Opciones */}
      <div className={styles.filterGroup}>
        <div className={styles.filterGroupHeader}>
          <span className={styles.filterLabel}>Entidades disponibles</span>
        </div>
        <input
          className={styles.filterTagInput}
          placeholder="Buscar entidad por nombre..."
          value={entitySearch}
          onChange={(e) => setEntitySearch(e.target.value)}
        />
        <div className={styles.entityScrollList}>
          {entidadesFiltradas.map((e) => (
            <button
              key={e.id}
              type="button"
              className={`${styles.filterChip} ${
                entidadesSeleccionadas.includes(e.label) ? styles.selected : ''
              }`}
              onClick={() => toggleEntidad(e.label)}
            >
              {e.label}
            </button>
          ))}
          {entidadesFiltradas.length === 0 && (
            <span className={styles.emptyStateText}>
              {entidades.length === 0
                ? 'Genera el grafo para ver entidades.'
                : 'Sin coincidencias para la búsqueda.'}
            </span>
          )}
        </div>
      </div>

      {/* Bloque Dinámico de Elementos Seleccionados y Operador Lógico */}
      {entidadesSeleccionadas.length > 0 && (
        <>
          <div className={styles.filterDivider} />
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>
              Seleccionadas ({entidadesSeleccionadas.length})
            </span>
            <div className={styles.filterChips}>
              {entidadesSeleccionadas.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={`${styles.filterChip} ${styles.selected}`}
                  onClick={() => toggleEntidad(name)}
                >
                  {name} <X size={11} style={{ marginLeft: 4 }} />
                </button>
              ))}
            </div>

            {entidadesSeleccionadas.length > 1 && (
              <div className={styles.logicToggle}>
                <span className={styles.filterLabel}>Combinar con operador:</span>
                <div className={styles.logicBtns}>
                  <button
                    type="button"
                    className={`${styles.logicBtn} ${logicaEntidades === 'OR' ? styles.active : ''}`}
                    onClick={() => setLogicaEntidades('OR')}
                  >
                    O (alguna)
                  </button>
                  <button
                    type="button"
                    className={`${styles.logicBtn} ${logicaEntidades === 'AND' ? styles.active : ''}`}
                    onClick={() => setLogicaEntidades('AND')}
                  >
                    Y (todas)
                  </button>
                </div>
              </div>
            )}

            <button
              type="button"
              className={styles.filterClearAll}
              onClick={() => setEntidadesSeleccionadas([])}
            >
              <X size={11} /> Limpiar selección
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default ModalFiltros