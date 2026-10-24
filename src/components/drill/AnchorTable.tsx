import React from 'react';

interface AnchorItem {
  offset: number;
  letter: string;
}

interface Props {
  anchors: readonly AnchorItem[];
}

export const AnchorTable: React.FC<Props> = ({ anchors }) => (
  <div className="sparse-table-wrapper">
    <table className="sparse-anchor-table">
      <colgroup>
        <col className="col-label" />
        {anchors.map(a => (
          <col key={a.letter} className="col-data" />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th className="anchor-header-cell">Letter</th>
          {anchors.map(a => (
            <th key={a.letter} className="anchor-col-cell anchor-letter">
              {a.letter}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td className="anchor-header-cell">Offset</td>
          {anchors.map(a => (
            <td key={a.letter} className="anchor-col-cell anchor-offset">
              {a.offset}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  </div>
);
